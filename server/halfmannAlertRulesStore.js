import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { getEmailConfig } from './emailSender.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = existsSync('/data') ? '/data' : join(__dirname, '../data')
const RULES_PATH = join(DATA_DIR, 'halfmann-alert-rules.json')
const AUDIT_LOG_PATH = join(DATA_DIR, 'halfmann-alert-rules-audit.ndjson')
const HISTORY_LOG_PATH = join(DATA_DIR, 'halfmann-alert-history.ndjson')
const RUNTIME_STATE_PATH = join(DATA_DIR, 'halfmann-alert-runtime-state.json')

export const HALFMANN_PANEL_DEVICE = { deviceId: '2507-501508', label: 'Halfmann Well Panel' }
export const HALFMANN_UNIT_MANIFEST = [
  { key: 'unit1396', deviceId: '2507-501442', label: 'Unit 1396 (Standby)', commandAddress: null, currentFlowAddress: null },
  { key: 'unit2127', deviceId: '2504-504108', label: 'Unit 2127', commandAddress: '460006', currentFlowAddress: '460404' },
  { key: 'unit2128', deviceId: '2507-500076', label: 'Unit 2128', commandAddress: '460002', currentFlowAddress: '460364' },
  { key: 'unit2129', deviceId: '2504-504102', label: 'Unit 2129', commandAddress: '460008', currentFlowAddress: '460424' },
  { key: 'unit2130', deviceId: '2507-500709', label: 'Unit 2130', commandAddress: '460004', currentFlowAddress: '460384' },
]
export const HALFMANN_WELL_MANIFEST = [
  {
    key: '214',
    label: 'Well 214',
    actualFlowAddress: '460212',
    targetFlowAddress: '460220',
    calculatedDesiredAddress: '460050',
    yesterdayFlowAddress: '460222',
    staticPressureAddress: '460214',
    differentialPressureAddress: '460216',
    casingPressureAddress: '400231',
    tubingPressureAddress: '400233',
    chokePositionAddress: '400017',
    oilPriorityAddress: '461036',
    gasPriorityAddress: '461002',
  },
  {
    key: '444',
    label: 'Well 444',
    actualFlowAddress: '460226',
    targetFlowAddress: '460234',
    calculatedDesiredAddress: '460052',
    yesterdayFlowAddress: '460236',
    staticPressureAddress: '460228',
    differentialPressureAddress: '460230',
    casingPressureAddress: '400235',
    tubingPressureAddress: '400237',
    chokePositionAddress: '400035',
    oilPriorityAddress: '461038',
    gasPriorityAddress: '461004',
  },
  {
    key: '334',
    label: 'Well 334',
    actualFlowAddress: '460240',
    targetFlowAddress: '460248',
    calculatedDesiredAddress: '460054',
    yesterdayFlowAddress: '460250',
    staticPressureAddress: '460242',
    differentialPressureAddress: '460244',
    casingPressureAddress: '400239',
    tubingPressureAddress: '400241',
    chokePositionAddress: '400053',
    oilPriorityAddress: '461040',
    gasPriorityAddress: '461006',
  },
  {
    key: '213',
    label: 'Well 213',
    actualFlowAddress: '460254',
    targetFlowAddress: '460262',
    calculatedDesiredAddress: '460056',
    yesterdayFlowAddress: '460264',
    staticPressureAddress: '460256',
    differentialPressureAddress: '460258',
    casingPressureAddress: '400243',
    tubingPressureAddress: '400245',
    chokePositionAddress: '400071',
    oilPriorityAddress: '461042',
    gasPriorityAddress: '461008',
  },
  {
    key: '333',
    label: 'Well 333',
    actualFlowAddress: '460268',
    targetFlowAddress: '460276',
    calculatedDesiredAddress: '460058',
    yesterdayFlowAddress: '460278',
    staticPressureAddress: '460270',
    differentialPressureAddress: '460272',
    casingPressureAddress: '400247',
    tubingPressureAddress: '400249',
    chokePositionAddress: '400089',
    oilPriorityAddress: '461044',
    gasPriorityAddress: '461010',
  },
]

export const COMPARATOR_OPTIONS = [
  { value: 'eq', label: 'Equals' },
  { value: 'neq', label: 'Does Not Equal' },
  { value: 'gt', label: 'Greater Than' },
  { value: 'gte', label: 'Greater Than Or Equal' },
  { value: 'lt', label: 'Less Than' },
  { value: 'lte', label: 'Less Than Or Equal' },
  { value: 'contains', label: 'Contains Text' },
]

export const EXPRESSION_OPERATOR_OPTIONS = [
  { value: 'add', label: 'Add (+)' },
  { value: 'subtract', label: 'Subtract (-)' },
  { value: 'multiply', label: 'Multiply (*)' },
  { value: 'divide', label: 'Divide (/)' },
]

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
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

function appendJsonLine(path, payload) {
  ensureDataDir()
  appendFileSync(path, `${JSON.stringify(payload)}\n`, 'utf8')
}

function readJsonLines(path, limit = 200) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
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

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value))
}

function createSimpleOperand(type = 'siteValue') {
  if (type === 'number') return { type: 'number', value: 0 }
  if (type === 'text') return { type: 'text', value: '' }
  if (type === 'boolean') return { type: 'boolean', value: true }
  if (type === 'customRegister') return { type: 'customRegister', scope: 'panel', deviceId: HALFMANN_PANEL_DEVICE.deviceId, address: '' }
  return { type: 'siteValue', key: 'site.dischargeOverrideLatch' }
}

function createOperand(type = 'siteValue') {
  if (type === 'expression') {
    return {
      type: 'expression',
      operator: 'subtract',
      left: createSimpleOperand('siteValue'),
      right: createSimpleOperand('number'),
    }
  }
  return createSimpleOperand(type)
}

export function createDefaultAlertRule() {
  return {
    id: randomUUID(),
    name: 'New alert rule',
    enabled: true,
    severity: 'warning',
    persistSeconds: 30,
    cooldownMinutes: 30,
    sendClear: false,
    recipients: [],
    condition: {
      left: createOperand('siteValue'),
      comparator: 'eq',
      right: createOperand('boolean'),
    },
    messageTemplate: '',
    updatedAt: null,
    updatedBy: null,
  }
}

function buildDefaultState() {
  return {
    version: 1,
    updatedAt: null,
    updatedBy: null,
    comment: '',
    rules: [],
  }
}

function normalizeSimpleOperand(rawOperand = {}) {
  const type = String(rawOperand.type || 'siteValue')
  if (type === 'number') return { type, value: Number(rawOperand.value) || 0 }
  if (type === 'text') return { type, value: String(rawOperand.value || '') }
  if (type === 'boolean') return { type, value: Boolean(rawOperand.value) }
  if (type === 'customRegister') {
    return {
      type,
      scope: rawOperand.scope === 'unit' ? 'unit' : 'panel',
      deviceId: String(rawOperand.deviceId || HALFMANN_PANEL_DEVICE.deviceId),
      address: String(rawOperand.address || '').trim(),
    }
  }
  return { type: 'siteValue', key: String(rawOperand.key || 'site.dischargeOverrideLatch') }
}

function normalizeOperand(rawOperand = {}) {
  const type = String(rawOperand.type || 'siteValue')
  if (type !== 'expression') return normalizeSimpleOperand(rawOperand)
  return {
    type: 'expression',
    operator: EXPRESSION_OPERATOR_OPTIONS.some((option) => option.value === rawOperand.operator) ? rawOperand.operator : 'subtract',
    left: normalizeSimpleOperand(rawOperand.left),
    right: normalizeSimpleOperand(rawOperand.right),
  }
}

function normalizeRule(rawRule = {}) {
  const fallback = createDefaultAlertRule()
  const recipients = Array.isArray(rawRule.recipients)
    ? rawRule.recipients.map(normalizeEmail).filter(Boolean)
    : String(rawRule.recipients || '')
      .split(/[\n,;]/)
      .map(normalizeEmail)
      .filter(Boolean)

  return {
    ...fallback,
    ...rawRule,
    id: String(rawRule.id || fallback.id),
    name: String(rawRule.name || fallback.name).trim() || fallback.name,
    enabled: rawRule.enabled !== false,
    severity: ['info', 'warning', 'critical'].includes(String(rawRule.severity || '')) ? rawRule.severity : 'warning',
    persistSeconds: Math.max(0, Math.round(Number(rawRule.persistSeconds) || 0)),
    cooldownMinutes: Math.max(0, Math.round(Number(rawRule.cooldownMinutes) || 0)),
    sendClear: Boolean(rawRule.sendClear),
    recipients,
    condition: {
      left: normalizeOperand(rawRule.condition?.left),
      comparator: COMPARATOR_OPTIONS.some((option) => option.value === rawRule.condition?.comparator) ? rawRule.condition.comparator : 'eq',
      right: normalizeOperand(rawRule.condition?.right),
    },
    messageTemplate: String(rawRule.messageTemplate || ''),
    updatedAt: rawRule.updatedAt || null,
    updatedBy: rawRule.updatedBy || null,
  }
}

function normalizeRulesState(rawState) {
  const base = buildDefaultState()
  const rules = Array.isArray(rawState?.rules) ? rawState.rules.map(normalizeRule) : []
  return {
    ...base,
    ...rawState,
    rules,
  }
}

export function loadHalfmannAlertRulesState() {
  return normalizeRulesState(safeReadJson(RULES_PATH, buildDefaultState()))
}

function validateSimpleOperand(operand, path, errors) {
  if (!operand || typeof operand !== 'object') {
    errors.push({ path, message: 'Operand is required.' })
    return
  }
  if (operand.type === 'siteValue') {
    if (!String(operand.key || '').trim()) errors.push({ path, message: 'Site value selection is required.' })
    return
  }
  if (operand.type === 'customRegister') {
    if (!String(operand.address || '').trim()) errors.push({ path, message: 'Register address is required.' })
    if (operand.scope === 'unit' && !String(operand.deviceId || '').trim()) {
      errors.push({ path, message: 'Unit device selection is required for custom unit registers.' })
    }
    return
  }
  if (operand.type === 'number') {
    if (!Number.isFinite(Number(operand.value))) errors.push({ path, message: 'Numeric constant must be a valid number.' })
    return
  }
  if (operand.type === 'text') return
  if (operand.type === 'boolean') return
  errors.push({ path, message: `Unsupported operand type "${operand.type}".` })
}

function validateOperand(operand, path, errors) {
  if (operand?.type !== 'expression') {
    validateSimpleOperand(operand, path, errors)
    return
  }
  if (!EXPRESSION_OPERATOR_OPTIONS.some((option) => option.value === operand.operator)) {
    errors.push({ path, message: 'Expression operator is invalid.' })
  }
  validateSimpleOperand(operand.left, `${path}.left`, errors)
  validateSimpleOperand(operand.right, `${path}.right`, errors)
}

function validateRules(rules) {
  const errors = []
  const seenIds = new Set()
  rules.forEach((rule, index) => {
    const path = `rules[${index}]`
    if (!rule.id) errors.push({ path: `${path}.id`, message: 'Rule id is required.' })
    if (seenIds.has(rule.id)) errors.push({ path: `${path}.id`, message: 'Rule id must be unique.' })
    seenIds.add(rule.id)
    if (!rule.name) errors.push({ path: `${path}.name`, message: 'Rule name is required.' })
    if (!COMPARATOR_OPTIONS.some((option) => option.value === rule.condition?.comparator)) {
      errors.push({ path: `${path}.condition.comparator`, message: 'Comparator is invalid.' })
    }
    if (rule.enabled && (!rule.recipients?.length || rule.recipients.some((email) => !isValidEmail(email)))) {
      errors.push({ path: `${path}.recipients`, message: 'Enabled rules need valid recipient email addresses.' })
    }
    if (rule.persistSeconds < 0) errors.push({ path: `${path}.persistSeconds`, message: 'Persist seconds cannot be negative.' })
    if (rule.cooldownMinutes < 0) errors.push({ path: `${path}.cooldownMinutes`, message: 'Cooldown minutes cannot be negative.' })
    validateOperand(rule.condition?.left, `${path}.condition.left`, errors)
    validateOperand(rule.condition?.right, `${path}.condition.right`, errors)
  })
  return errors
}

function writeRulesState(nextState) {
  writeJson(RULES_PATH, nextState)
}

function makeAuditEvent({ type, user = 'system', reason = '', ip = '', note = '', ruleId = null, oldValue = null, newValue = null }) {
  return {
    type,
    user,
    reason: String(reason || '').trim() || null,
    ip: ip || null,
    note: note || null,
    ruleId,
    oldValue,
    newValue,
    timestamp: new Date().toISOString(),
  }
}

export function appendHalfmannAlertAudit(event) {
  appendJsonLine(AUDIT_LOG_PATH, event)
}

export function appendHalfmannAlertHistory(event) {
  appendJsonLine(HISTORY_LOG_PATH, event)
}

export function loadHalfmannAlertHistory(limit = 100) {
  return readJsonLines(HISTORY_LOG_PATH, limit)
}

export function loadHalfmannAlertAuditLog(limit = 200) {
  return readJsonLines(AUDIT_LOG_PATH, limit)
}

export function loadHalfmannAlertRuntimeState() {
  return safeReadJson(RUNTIME_STATE_PATH, { rules: {} })
}

export function saveHalfmannAlertRuntimeState(nextState) {
  writeJson(RUNTIME_STATE_PATH, nextState || { rules: {} })
}

export function listAlertFieldCatalog() {
  const fields = [
    { key: 'site.dischargeOverrideLatch', label: 'Discharge Override Latch', unit: 'signal' },
    { key: 'site.dischargeOverrideCompSpeedSp', label: 'Override Compressor Speed SP', unit: 'signal' },
    { key: 'site.recycleValvePosition', label: 'Recycle Valve Position', unit: '%' },
    { key: 'site.totalDesiredFlow', label: 'Total Desired Site Flow', unit: 'MMSCFD' },
    { key: 'site.totalActualFlow', label: 'Total Site Flow', unit: 'MMSCFD' },
    { key: 'site.totalAscCompressorFlow', label: 'Total ASC Compressor Flow', unit: 'MMSCFD' },
    { key: 'site.flowGap', label: 'Site Flow Gap (Actual - Desired)', unit: 'MMSCFD' },
    { key: 'site.compressorsMeetingFlowDemand', label: 'Compressors Meeting Flow Demand', unit: 'signal' },
    { key: 'site.anyCompressorNotMeetingDesiredFlow', label: 'Any Compressor Not Meeting Desired Flow', unit: 'signal' },
    { key: 'site.anyWellBelowSetpoint', label: 'Any Well Below Setpoint', unit: 'signal' },
    { key: 'site.flowTargetBeingReduced', label: 'Flow Target Being Reduced', unit: 'signal' },
    { key: 'site.recommendedCompressors', label: 'Recommended Compressors', unit: 'count' },
    { key: 'site.wellsMeetingRateCount', label: 'Wells Meeting Rate Count', unit: 'count' },
    { key: 'site.allWellsMeetingFlow', label: 'All Wells Meeting Flow', unit: 'signal' },
    { key: 'site.compressorLimited', label: 'Compressor Limited', unit: 'signal' },
  ]

  for (const well of HALFMANN_WELL_MANIFEST) {
    fields.push(
      { key: `well.${well.key}.actualFlow`, label: `${well.label} Actual Flow`, unit: 'MMSCFD' },
      { key: `well.${well.key}.targetFlow`, label: `${well.label} Target Flow`, unit: 'MMSCFD' },
      { key: `well.${well.key}.calculatedDesiredFlow`, label: `${well.label} Calculated Desired Flow`, unit: 'MMSCFD' },
      { key: `well.${well.key}.matchPct`, label: `${well.label} Flow Match %`, unit: '%' },
      { key: `well.${well.key}.shortfall`, label: `${well.label} Flow Shortfall`, unit: 'MMSCFD' },
      { key: `well.${well.key}.yesterdayFlow`, label: `${well.label} Yesterday Flow`, unit: 'MMSCFD' },
      { key: `well.${well.key}.staticPressure`, label: `${well.label} Static Pressure`, unit: 'PSI' },
      { key: `well.${well.key}.differentialPressure`, label: `${well.label} Differential Pressure`, unit: 'In/H2o' },
      { key: `well.${well.key}.casingPressure`, label: `${well.label} Casing Pressure`, unit: 'PSI' },
      { key: `well.${well.key}.tubingPressure`, label: `${well.label} Tubing Pressure`, unit: 'PSI' },
      { key: `well.${well.key}.chokePosition`, label: `${well.label} Choke Position`, unit: '%' },
      { key: `well.${well.key}.oilPriority`, label: `${well.label} Oil Priority`, unit: 'rank' },
      { key: `well.${well.key}.gasPriority`, label: `${well.label} Gas Priority`, unit: 'rank' },
      { key: `well.${well.key}.isShort`, label: `${well.label} Below Target`, unit: 'signal' },
    )
  }

  for (const unit of HALFMANN_UNIT_MANIFEST) {
    fields.push(
      { key: `unit.${unit.key}.actualFlow`, label: `${unit.label} Actual Flow`, unit: 'MMSCFD' },
      { key: `unit.${unit.key}.desiredFlow`, label: `${unit.label} Desired Flow Command`, unit: 'MMSCFD' },
      { key: `unit.${unit.key}.flowMismatchPct`, label: `${unit.label} Flow Mismatch %`, unit: '%' },
      { key: `unit.${unit.key}.suctionPressure`, label: `${unit.label} Suction Pressure`, unit: 'PSI' },
      { key: `unit.${unit.key}.dischargePressure`, label: `${unit.label} Discharge Pressure`, unit: 'PSI' },
      { key: `unit.${unit.key}.loadedAutoSp`, label: `${unit.label} Loaded Auto SP`, unit: 'PSI' },
      { key: `unit.${unit.key}.engineSpeed`, label: `${unit.label} Engine Speed`, unit: 'RPM' },
    )
  }

  return fields
}

export function getHalfmannAlertRulesAdminPayload(limit = 100) {
  const state = loadHalfmannAlertRulesState()
  return {
    fetchedAt: new Date().toISOString(),
    rules: state.rules,
    updatedAt: state.updatedAt,
    updatedBy: state.updatedBy,
    comment: state.comment || '',
    email: {
      configured: getEmailConfig().configured,
      fromConfigured: Boolean(getEmailConfig().from),
    },
    defaults: {
      rule: createDefaultAlertRule(),
    },
    options: {
      comparators: COMPARATOR_OPTIONS,
      expressionOperators: EXPRESSION_OPERATOR_OPTIONS,
      fieldCatalog: listAlertFieldCatalog(),
      devices: [HALFMANN_PANEL_DEVICE, ...HALFMANN_UNIT_MANIFEST.map((unit) => ({ deviceId: unit.deviceId, label: unit.label }))],
    },
    auditLog: loadHalfmannAlertAuditLog(limit),
    history: loadHalfmannAlertHistory(limit),
  }
}

export function saveHalfmannAlertRules(nextRulesInput, { user, reason, ip } = {}) {
  const current = loadHalfmannAlertRulesState()
  const nextRules = Array.isArray(nextRulesInput) ? nextRulesInput.map(normalizeRule) : []
  const errors = validateRules(nextRules)
  if (errors.length) {
    const error = new Error('Alert rules validation failed')
    error.status = 400
    error.payload = errors
    throw error
  }

  const timestamp = new Date().toISOString()
  const nextState = {
    ...current,
    updatedAt: timestamp,
    updatedBy: user || 'system',
    comment: String(reason || '').trim(),
    rules: nextRules.map((rule) => ({
      ...rule,
      updatedAt: timestamp,
      updatedBy: user || 'system',
    })),
  }

  writeRulesState(nextState)
  appendHalfmannAlertAudit(makeAuditEvent({
    type: 'alert-rules-saved',
    user,
    reason,
    ip,
    note: `${nextRules.length} rule(s) saved`,
    oldValue: current.rules.length,
    newValue: nextRules.length,
  }))
  return getHalfmannAlertRulesAdminPayload()
}
