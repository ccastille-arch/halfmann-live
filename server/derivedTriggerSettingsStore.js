import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  DEFAULT_DERIVED_TRIGGER_SETTINGS,
  DERIVED_TRIGGER_SETTINGS_SCHEMA,
  deepClone,
  getDefaultMetadataMap,
  getLegacySiteSettings,
  listDerivedSettingDefinitions,
  mergeDerivedTriggerSettings,
  validateDerivedTriggerSettings,
} from '../shared/derivedTriggerSettings.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = existsSync('/data') ? '/data' : join(__dirname, '../data')
const SETTINGS_PATH = join(DATA_DIR, 'derived-trigger-settings.json')
const AUDIT_LOG_PATH = join(DATA_DIR, 'derived-trigger-settings-audit.ndjson')

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function safeReadJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(path, payload) {
  ensureDataDir()
  writeFileSync(path, JSON.stringify(payload, null, 2))
}

function appendAudit(payload) {
  ensureDataDir()
  appendFileSync(AUDIT_LOG_PATH, `${JSON.stringify(payload)}\n`, 'utf8')
}

function readAuditLog(limit = 200) {
  if (!existsSync(AUDIT_LOG_PATH)) return []
  const lines = readFileSync(AUDIT_LOG_PATH, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .reverse()
}

function buildDefaultState() {
  return {
    version: 1,
    updatedAt: null,
    updatedBy: null,
    comment: '',
    derivedTriggerSettings: deepClone(DEFAULT_DERIVED_TRIGGER_SETTINGS),
    metadata: getDefaultMetadataMap(),
  }
}

function normalizeState(rawState) {
  const base = buildDefaultState()
  const validated = validateDerivedTriggerSettings(rawState?.derivedTriggerSettings || rawState || {})
  const metadata = {
    ...base.metadata,
    ...(rawState?.metadata || {}),
  }
  return {
    ...base,
    ...rawState,
    derivedTriggerSettings: validated.settings,
    metadata,
  }
}

export function loadDerivedTriggerSettingsState() {
  return normalizeState(safeReadJson(SETTINGS_PATH, buildDefaultState()))
}

function persistDerivedTriggerSettingsState(nextState) {
  writeJson(SETTINGS_PATH, nextState)
  return nextState
}

function makeAuditContext({ user = 'system', reason = '', ip = '', action = 'config-change' } = {}) {
  return {
    action,
    user,
    reason: String(reason || '').trim() || null,
    ip: ip || null,
    timestamp: new Date().toISOString(),
  }
}

function getPathValue(settings, path) {
  return path.split('.').reduce((current, key) => current?.[key], settings)
}

function setPathValue(settings, path, value) {
  const parts = path.split('.')
  const last = parts.pop()
  let current = settings
  for (const part of parts) {
    if (!current[part] || typeof current[part] !== 'object') current[part] = {}
    current = current[part]
  }
  current[last] = value
}

function recordSettingDiffs({ previousSettings, nextSettings, previousMetadata, auditContext }) {
  const nextMetadata = { ...previousMetadata }
  let changed = false

  for (const definition of listDerivedSettingDefinitions()) {
    const before = getPathValue(previousSettings, definition.path)
    const after = getPathValue(nextSettings, definition.path)
    if (Object.is(before, after)) continue
    changed = true
    nextMetadata[definition.path] = {
      lastChangedBy: auditContext.user,
      lastChangedAt: auditContext.timestamp,
    }
    appendAudit({
      ...auditContext,
      type: 'derived-setting-change',
      settingKey: definition.path,
      oldValue: before,
      newValue: after,
    })
  }

  return { nextMetadata, changed }
}

export function getDerivedTriggerSettingsPublicPayload() {
  const state = loadDerivedTriggerSettingsState()
  return {
    fetchedAt: new Date().toISOString(),
    derivedTriggerSettings: state.derivedTriggerSettings,
    legacySettings: getLegacySiteSettings(state.derivedTriggerSettings),
  }
}

export function getDerivedTriggerSettingsAdminPayload(limit = 200) {
  const state = loadDerivedTriggerSettingsState()
  return {
    fetchedAt: new Date().toISOString(),
    derivedTriggerSettings: state.derivedTriggerSettings,
    metadata: state.metadata,
    schema: DERIVED_TRIGGER_SETTINGS_SCHEMA,
    legacySettings: getLegacySiteSettings(state.derivedTriggerSettings),
    updatedAt: state.updatedAt,
    updatedBy: state.updatedBy,
    comment: state.comment || '',
    auditLog: readAuditLog(limit),
  }
}

export function saveDerivedTriggerSettings(nextInput, { user, reason, ip } = {}) {
  const current = loadDerivedTriggerSettingsState()
  const validation = validateDerivedTriggerSettings(nextInput)
  if (!validation.valid) {
    const error = new Error('Derived trigger settings validation failed')
    error.status = 400
    error.payload = validation.errors
    throw error
  }

  const auditContext = makeAuditContext({ user, reason, ip, action: 'config-save' })
  const { nextMetadata, changed } = recordSettingDiffs({
    previousSettings: current.derivedTriggerSettings,
    nextSettings: validation.settings,
    previousMetadata: current.metadata,
    auditContext,
  })

  const nextState = {
    ...current,
    updatedAt: changed ? auditContext.timestamp : current.updatedAt,
    updatedBy: changed ? auditContext.user : current.updatedBy,
    comment: changed ? (auditContext.reason || '') : current.comment,
    derivedTriggerSettings: validation.settings,
    metadata: nextMetadata,
  }

  persistDerivedTriggerSettingsState(nextState)
  return getDerivedTriggerSettingsAdminPayload()
}

export function resetDerivedTriggerSettingsGroup(groupKey, { user, reason, ip } = {}) {
  const current = loadDerivedTriggerSettingsState()
  if (!DERIVED_TRIGGER_SETTINGS_SCHEMA[groupKey]) {
    const error = new Error('Unknown settings group')
    error.status = 404
    throw error
  }
  const nextSettings = mergeDerivedTriggerSettings(current.derivedTriggerSettings)
  nextSettings[groupKey] = deepClone(DEFAULT_DERIVED_TRIGGER_SETTINGS[groupKey])
  return saveDerivedTriggerSettings(nextSettings, { user, reason, ip })
}

export function resetDerivedTriggerSetting(path, { user, reason, ip } = {}) {
  const current = loadDerivedTriggerSettingsState()
  const definition = listDerivedSettingDefinitions().find((item) => item.path === path)
  if (!definition) {
    const error = new Error('Unknown setting key')
    error.status = 404
    throw error
  }
  const nextSettings = mergeDerivedTriggerSettings(current.derivedTriggerSettings)
  setPathValue(nextSettings, path, definition.defaultValue)
  return saveDerivedTriggerSettings(nextSettings, { user, reason, ip })
}

export function importDerivedTriggerSettings(payload, { user, reason, ip } = {}) {
  const settings = payload?.derivedTriggerSettings || payload
  return saveDerivedTriggerSettings(settings, { user, reason, ip })
}

export function exportDerivedTriggerSettingsPayload() {
  const state = loadDerivedTriggerSettingsState()
  return {
    exportedAt: new Date().toISOString(),
    derivedTriggerSettings: state.derivedTriggerSettings,
    metadata: state.metadata,
    schemaVersion: state.version,
  }
}

export function logDerivedTriggerSettingsAuditEvent({ type, user, reason, ip, success, settingKey = null, oldValue = null, newValue = null, note = null }) {
  appendAudit({
    ...makeAuditContext({ user, reason, ip, action: type }),
    type,
    success: typeof success === 'boolean' ? success : undefined,
    settingKey,
    oldValue,
    newValue,
    note,
  })
}

export function getDerivedTriggerSettingsAuditLog(limit = 200) {
  return readAuditLog(limit)
}
