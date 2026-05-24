import { sendAlertEmail } from './emailSender.js'
import {
  appendHalfmannAlertHistory,
  HALFMANN_PANEL_DEVICE,
  HALFMANN_UNIT_MANIFEST,
  HALFMANN_WELL_MANIFEST,
  loadHalfmannAlertRulesState,
  loadHalfmannAlertRuntimeState,
  saveHalfmannAlertRuntimeState,
} from './halfmannAlertRulesStore.js'

function normalizeAddress(value) {
  return String(value ?? '').trim().toLowerCase()
}

function parseNumeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized === 'UNAVAILABLE' || normalized === 'INVALID' || normalized === '--') return null
  const numeric = Number(normalized.replace(/,/g, ''))
  return Number.isFinite(numeric) ? numeric : null
}

function parseBooleanSignal(value) {
  if (typeof value === 'boolean') return value
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return null
  if (['yes', 'yes (1)', 'yes (2)', 'true', '1', '2', 'running (1)', 'online (1)', 'auto (1)'].includes(normalized)) return true
  if (['no', 'no (0)', 'false', '0', 'stopped (0)', 'offline (0)', 'auto (0)'].includes(normalized)) return false
  return null
}

function normalizeComparable(value) {
  if (value == null) return null
  if (typeof value === 'boolean') return value
  const numeric = parseNumeric(value)
  if (numeric != null) return numeric
  const booleanSignal = parseBooleanSignal(value)
  if (booleanSignal != null) return booleanSignal
  return String(value).trim().toLowerCase()
}

function findDatapoint(snapshot, address) {
  const datapoints = Array.isArray(snapshot?.datapoints) ? snapshot.datapoints : []
  return datapoints.find((datapoint) =>
    normalizeAddress(datapoint.addressStr || datapoint.address) === normalizeAddress(address),
  ) || null
}

function getValueWithMeta(snapshot, address) {
  const datapoint = findDatapoint(snapshot, address)
  if (!datapoint) return { value: null, raw: null, units: null }
  const raw = datapoint.value
  const numeric = parseNumeric(raw)
  const booleanSignal = parseBooleanSignal(raw)
  return {
    value: numeric != null ? numeric : booleanSignal != null ? booleanSignal : raw,
    raw,
    units: datapoint.units || null,
  }
}

function getUnitByKey(key) {
  return HALFMANN_UNIT_MANIFEST.find((unit) => unit.key === key) || null
}

function buildContextValues(panelSnapshot, unitSnapshots) {
  const unitIndex = new Map(unitSnapshots.map((snapshot) => [snapshot.deviceId, snapshot]))
  const values = {}

  const setValue = (key, value, meta = {}) => {
    values[key] = {
      value,
      label: meta.label || key,
      unit: meta.unit || null,
      deviceId: meta.deviceId || null,
    }
  }

  const panelFields = [
    ['site.dischargeOverrideLatch', '460018', 'Discharge Override Latch', 'signal'],
    ['site.dischargeOverrideCompSpeedSp', '460020', 'Override Compressor Speed SP', 'signal'],
    ['site.recycleValvePosition', '400189', 'Recycle Valve Position', '%'],
    ['site.totalDesiredFlow', '420003', 'Total Desired Site Flow', 'MMSCFD'],
    ['site.totalActualFlow', '420005', 'Total Site Flow', 'MMSCFD'],
    ['site.totalAscCompressorFlow', '420012', 'Total ASC Compressor Flow', 'MMSCFD'],
    ['site.compressorsMeetingFlowDemand', '420018', 'Compressors Meeting Flow Demand', 'signal'],
    ['site.anyCompressorNotMeetingDesiredFlow', '420023', 'Any Compressor Not Meeting Desired Flow', 'signal'],
    ['site.anyWellBelowSetpoint', '420021', 'Any Well Below Setpoint', 'signal'],
    ['site.flowTargetBeingReduced', '420034', 'Flow Target Being Reduced', 'signal'],
    ['site.recommendedCompressors', '420039', 'Recommended Compressors', 'count'],
    ['site.wellsMeetingRateCount', '420041', 'Wells Meeting Rate Count', 'count'],
    ['site.allWellsMeetingFlow', '420031', 'All Wells Meeting Flow', 'signal'],
    ['site.compressorLimited', '420024', 'Compressor Limited', 'signal'],
  ]
  for (const [key, address, label, unit] of panelFields) {
    const point = getValueWithMeta(panelSnapshot, address)
    setValue(key, point.value, { label, unit, deviceId: HALFMANN_PANEL_DEVICE.deviceId })
  }

  const desired = values['site.totalDesiredFlow']?.value
  const actual = values['site.totalActualFlow']?.value
  setValue('site.flowGap', typeof actual === 'number' && typeof desired === 'number' ? actual - desired : null, {
    label: 'Site Flow Gap (Actual - Desired)',
    unit: 'MMSCFD',
    deviceId: HALFMANN_PANEL_DEVICE.deviceId,
  })

  for (const well of HALFMANN_WELL_MANIFEST) {
    const actualFlow = getValueWithMeta(panelSnapshot, well.actualFlowAddress).value
    const targetFlow = getValueWithMeta(panelSnapshot, well.targetFlowAddress).value
    const calculatedDesired = getValueWithMeta(panelSnapshot, well.calculatedDesiredAddress).value
    const yesterdayFlow = getValueWithMeta(panelSnapshot, well.yesterdayFlowAddress).value
    const staticPressure = getValueWithMeta(panelSnapshot, well.staticPressureAddress).value
    const differentialPressure = getValueWithMeta(panelSnapshot, well.differentialPressureAddress).value
    const casingPressure = getValueWithMeta(panelSnapshot, well.casingPressureAddress).value
    const tubingPressure = getValueWithMeta(panelSnapshot, well.tubingPressureAddress).value
    const chokePosition = getValueWithMeta(panelSnapshot, well.chokePositionAddress).value
    const oilPriority = getValueWithMeta(panelSnapshot, well.oilPriorityAddress).value
    const gasPriority = getValueWithMeta(panelSnapshot, well.gasPriorityAddress).value
    const matchPct = typeof actualFlow === 'number' && typeof targetFlow === 'number' && targetFlow > 0
      ? (actualFlow / targetFlow) * 100
      : null
    const shortfall = typeof actualFlow === 'number' && typeof targetFlow === 'number'
      ? targetFlow - actualFlow
      : null

    setValue(`well.${well.key}.actualFlow`, actualFlow, { label: `${well.label} Actual Flow`, unit: 'MMSCFD', deviceId: HALFMANN_PANEL_DEVICE.deviceId })
    setValue(`well.${well.key}.targetFlow`, targetFlow, { label: `${well.label} Target Flow`, unit: 'MMSCFD', deviceId: HALFMANN_PANEL_DEVICE.deviceId })
    setValue(`well.${well.key}.calculatedDesiredFlow`, calculatedDesired, { label: `${well.label} Calculated Desired Flow`, unit: 'MMSCFD', deviceId: HALFMANN_PANEL_DEVICE.deviceId })
    setValue(`well.${well.key}.yesterdayFlow`, yesterdayFlow, { label: `${well.label} Yesterday Flow`, unit: 'MMSCFD', deviceId: HALFMANN_PANEL_DEVICE.deviceId })
    setValue(`well.${well.key}.staticPressure`, staticPressure, { label: `${well.label} Static Pressure`, unit: 'PSI', deviceId: HALFMANN_PANEL_DEVICE.deviceId })
    setValue(`well.${well.key}.differentialPressure`, differentialPressure, { label: `${well.label} Differential Pressure`, unit: 'In/H2o', deviceId: HALFMANN_PANEL_DEVICE.deviceId })
    setValue(`well.${well.key}.casingPressure`, casingPressure, { label: `${well.label} Casing Pressure`, unit: 'PSI', deviceId: HALFMANN_PANEL_DEVICE.deviceId })
    setValue(`well.${well.key}.tubingPressure`, tubingPressure, { label: `${well.label} Tubing Pressure`, unit: 'PSI', deviceId: HALFMANN_PANEL_DEVICE.deviceId })
    setValue(`well.${well.key}.chokePosition`, chokePosition, { label: `${well.label} Choke Position`, unit: '%', deviceId: HALFMANN_PANEL_DEVICE.deviceId })
    setValue(`well.${well.key}.oilPriority`, oilPriority, { label: `${well.label} Oil Priority`, unit: 'rank', deviceId: HALFMANN_PANEL_DEVICE.deviceId })
    setValue(`well.${well.key}.gasPriority`, gasPriority, { label: `${well.label} Gas Priority`, unit: 'rank', deviceId: HALFMANN_PANEL_DEVICE.deviceId })
    setValue(`well.${well.key}.matchPct`, matchPct, { label: `${well.label} Flow Match %`, unit: '%', deviceId: HALFMANN_PANEL_DEVICE.deviceId })
    setValue(`well.${well.key}.shortfall`, shortfall, { label: `${well.label} Flow Shortfall`, unit: 'MMSCFD', deviceId: HALFMANN_PANEL_DEVICE.deviceId })
    setValue(`well.${well.key}.isShort`, typeof shortfall === 'number' ? shortfall > 0 : null, { label: `${well.label} Below Target`, unit: 'signal', deviceId: HALFMANN_PANEL_DEVICE.deviceId })
  }

  for (const unit of HALFMANN_UNIT_MANIFEST) {
    const snapshot = unitIndex.get(unit.deviceId)
    const actualFlowDirect = getValueWithMeta(snapshot, '400656').value
    const actualFlowPanel = unit.currentFlowAddress ? getValueWithMeta(panelSnapshot, unit.currentFlowAddress).value : null
    const actualFlow = actualFlowDirect ?? actualFlowPanel
    const desiredFlow = unit.commandAddress ? getValueWithMeta(panelSnapshot, unit.commandAddress).value : null
    const flowMismatchPct = typeof actualFlow === 'number' && typeof desiredFlow === 'number' && desiredFlow !== 0
      ? ((actualFlow - desiredFlow) / desiredFlow) * 100
      : null
    const suctionPressure = getValueWithMeta(snapshot, '400505').value
    const dischargePressure = getValueWithMeta(snapshot, '400510').value
    const loadedAutoSp = getValueWithMeta(snapshot, '401018').value
    const engineSpeed = getValueWithMeta(snapshot, '400105').value ?? getValueWithMeta(snapshot, '16777216').value

    setValue(`unit.${unit.key}.actualFlow`, actualFlow, { label: `${unit.label} Actual Flow`, unit: 'MMSCFD', deviceId: unit.deviceId })
    setValue(`unit.${unit.key}.desiredFlow`, desiredFlow, { label: `${unit.label} Desired Flow Command`, unit: 'MMSCFD', deviceId: unit.deviceId })
    setValue(`unit.${unit.key}.flowMismatchPct`, flowMismatchPct, { label: `${unit.label} Flow Mismatch %`, unit: '%', deviceId: unit.deviceId })
    setValue(`unit.${unit.key}.suctionPressure`, suctionPressure, { label: `${unit.label} Suction Pressure`, unit: 'PSI', deviceId: unit.deviceId })
    setValue(`unit.${unit.key}.dischargePressure`, dischargePressure, { label: `${unit.label} Discharge Pressure`, unit: 'PSI', deviceId: unit.deviceId })
    setValue(`unit.${unit.key}.loadedAutoSp`, loadedAutoSp, { label: `${unit.label} Loaded Auto SP`, unit: 'PSI', deviceId: unit.deviceId })
    setValue(`unit.${unit.key}.engineSpeed`, engineSpeed, { label: `${unit.label} Engine Speed`, unit: 'RPM', deviceId: unit.deviceId })
  }

  return {
    values,
    snapshotIndex: new Map([
      [HALFMANN_PANEL_DEVICE.deviceId, panelSnapshot],
      ...unitSnapshots.map((snapshot) => [snapshot.deviceId, snapshot]),
    ]),
  }
}

function resolveSimpleOperand(context, operand) {
  if (!operand || typeof operand !== 'object') return { value: null, label: 'Missing operand', unit: null }
  if (operand.type === 'siteValue') {
    return context.values[operand.key] || { value: null, label: operand.key || 'Unknown site value', unit: null }
  }
  if (operand.type === 'customRegister') {
    const deviceId = operand.scope === 'unit' ? operand.deviceId : HALFMANN_PANEL_DEVICE.deviceId
    const snapshot = context.snapshotIndex.get(deviceId)
    const value = getValueWithMeta(snapshot, operand.address)
    return {
      value: value.value,
      label: `${operand.scope === 'unit' ? (getUnitByKey(HALFMANN_UNIT_MANIFEST.find((unit) => unit.deviceId === deviceId)?.key)?.label || deviceId) : HALFMANN_PANEL_DEVICE.label} register ${operand.address}`,
      unit: value.units,
      deviceId,
    }
  }
  if (operand.type === 'number') return { value: Number(operand.value), label: String(operand.value), unit: null }
  if (operand.type === 'text') return { value: String(operand.value || ''), label: String(operand.value || ''), unit: null }
  if (operand.type === 'boolean') return { value: Boolean(operand.value), label: Boolean(operand.value) ? 'Yes' : 'No', unit: null }
  return { value: null, label: 'Unsupported operand', unit: null }
}

function resolveOperand(context, operand) {
  if (operand?.type !== 'expression') return resolveSimpleOperand(context, operand)
  const left = resolveSimpleOperand(context, operand.left)
  const right = resolveSimpleOperand(context, operand.right)
  const leftNumber = parseNumeric(left.value)
  const rightNumber = parseNumeric(right.value)
  let value = null
  if (leftNumber != null && rightNumber != null) {
    if (operand.operator === 'add') value = leftNumber + rightNumber
    if (operand.operator === 'subtract') value = leftNumber - rightNumber
    if (operand.operator === 'multiply') value = leftNumber * rightNumber
    if (operand.operator === 'divide') value = rightNumber === 0 ? null : leftNumber / rightNumber
  }
  const operatorLabel = { add: '+', subtract: '-', multiply: '*', divide: '/' }[operand.operator] || operand.operator
  return {
    value,
    label: `${left.label} ${operatorLabel} ${right.label}`,
    unit: left.unit || right.unit || null,
  }
}

function compareValues(leftValue, comparator, rightValue) {
  const left = normalizeComparable(leftValue)
  const right = normalizeComparable(rightValue)
  if (comparator === 'contains') {
    if (left == null || right == null) return false
    return String(left).includes(String(right))
  }
  if (['gt', 'gte', 'lt', 'lte'].includes(comparator)) {
    if (typeof left !== 'number' || typeof right !== 'number') return false
    if (comparator === 'gt') return left > right
    if (comparator === 'gte') return left >= right
    if (comparator === 'lt') return left < right
    if (comparator === 'lte') return left <= right
  }
  if (comparator === 'neq') return left !== right
  return left === right
}

function formatValue(value, unit = '') {
  if (value == null) return '--'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '--'
    const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(3)
    return unit ? `${rounded} ${unit}` : rounded
  }
  return unit ? `${String(value)} ${unit}` : String(value)
}

function buildEmailText({ rule, leftResolved, rightResolved, comparatorLabel, capturedAt }) {
  const baseLines = [
    `Halfmann alert: ${rule.name}`,
    '',
    `Severity: ${rule.severity}`,
    `Triggered at: ${new Date(capturedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })}`,
    '',
    `Condition: ${leftResolved.label} ${comparatorLabel} ${rightResolved.label}`,
    `Current values: ${formatValue(leftResolved.value, leftResolved.unit)} ${comparatorLabel} ${formatValue(rightResolved.value, rightResolved.unit)}`,
  ]
  if (rule.messageTemplate?.trim()) {
    baseLines.push('', `Note: ${rule.messageTemplate.trim()}`)
  }
  return baseLines.join('\n')
}

export async function evaluateHalfmannAlertRules({ capturedAt, panelSnapshot, unitSnapshots }) {
  const rulesState = loadHalfmannAlertRulesState()
  if (!rulesState.rules.length) return

  const context = buildContextValues(panelSnapshot, unitSnapshots)
  const runtimeState = loadHalfmannAlertRuntimeState()
  const nextRuntimeRules = { ...(runtimeState.rules || {}) }
  const nowMs = new Date(capturedAt).getTime()
  let stateChanged = false

  for (const rule of rulesState.rules) {
    const priorState = nextRuntimeRules[rule.id] || {
      active: false,
      firstMatchedAt: null,
      lastTriggeredAt: null,
      lastClearedAt: null,
    }
    const leftResolved = resolveOperand(context, rule.condition.left)
    const rightResolved = resolveOperand(context, rule.condition.right)
    const matched = rule.enabled && compareValues(leftResolved.value, rule.condition.comparator, rightResolved.value)

    let nextState = { ...priorState }
    if (matched) {
      nextState.firstMatchedAt = nextState.firstMatchedAt || capturedAt
      const persistMs = Math.max(0, Number(rule.persistSeconds || 0) * 1000)
      const firstMatchMs = new Date(nextState.firstMatchedAt).getTime()
      const persistedLongEnough = nowMs - firstMatchMs >= persistMs
      const cooldownMs = Math.max(0, Number(rule.cooldownMinutes || 0) * 60 * 1000)
      const lastTriggeredMs = nextState.lastTriggeredAt ? new Date(nextState.lastTriggeredAt).getTime() : 0
      const cooldownSatisfied = !lastTriggeredMs || nowMs - lastTriggeredMs >= cooldownMs

      if (persistedLongEnough && !nextState.active && cooldownSatisfied) {
        const comparatorLabel = {
          eq: '=',
          neq: '!=',
          gt: '>',
          gte: '>=',
          lt: '<',
          lte: '<=',
          contains: 'contains',
        }[rule.condition.comparator] || rule.condition.comparator
        const subject = `[Halfmann ${rule.severity.toUpperCase()}] ${rule.name}`
        const text = buildEmailText({ rule, leftResolved, rightResolved, comparatorLabel, capturedAt })
        let emailStatus = 'sent'
        let errorMessage = null
        try {
          await sendAlertEmail({ to: rule.recipients, subject, text })
        } catch (err) {
          emailStatus = 'error'
          errorMessage = err.message
        }

        nextState = {
          ...nextState,
          active: true,
          lastTriggeredAt: capturedAt,
        }
        stateChanged = true
        appendHalfmannAlertHistory({
          ts: capturedAt,
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          event: 'triggered',
          emailStatus,
          errorMessage,
          recipients: rule.recipients,
          leftLabel: leftResolved.label,
          leftValue: leftResolved.value,
          rightLabel: rightResolved.label,
          rightValue: rightResolved.value,
        })
      }
    } else {
      if (nextState.active) {
        stateChanged = true
        appendHalfmannAlertHistory({
          ts: capturedAt,
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          event: 'cleared',
          recipients: rule.recipients,
        })
        if (rule.sendClear) {
          try {
            await sendAlertEmail({
              to: rule.recipients,
              subject: `[Halfmann CLEAR] ${rule.name}`,
              text: `Halfmann alert cleared: ${rule.name}\n\nCleared at: ${new Date(capturedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })}`,
            })
          } catch {}
        }
      }
      nextState = {
        ...nextState,
        active: false,
        firstMatchedAt: null,
        lastClearedAt: capturedAt,
      }
    }

    if (
      nextState.active !== priorState.active ||
      nextState.firstMatchedAt !== priorState.firstMatchedAt ||
      nextState.lastTriggeredAt !== priorState.lastTriggeredAt ||
      nextState.lastClearedAt !== priorState.lastClearedAt
    ) {
      stateChanged = true
    }
    nextRuntimeRules[rule.id] = nextState
  }

  if (stateChanged) {
    saveHalfmannAlertRuntimeState({ rules: nextRuntimeRules, updatedAt: capturedAt })
  }
}
