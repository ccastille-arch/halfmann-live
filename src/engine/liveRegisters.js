import * as XLSX from 'xlsx'

const BASE = import.meta.env.BASE_URL || '/'
const AWI_REGISTER_DOC = `${BASE}docs/Wellhead_SCADA_AWI_Registers.xlsx`

let registerCatalogPromise = null

export const LIVE_DATA_DEVICES = {
  panel: '2504-504495',
  compA: '2504-505561',
  compB: '2504-505472',
}

// Canonical compressor parameters. Names match the 2074 asset CSV
// export verbatim — including Murphy's typo "Quck" in
// "Quck Start Setting - Desired Flow Rate". DO NOT fix the typo:
// the publishing side spells it that way and any normalization
// here breaks the lookup.
export const COMPRESSOR_DEFAULT_VISIBLE_LABELS = [
  '3rd Stage Discharge Temperature',
  'Compressor Speed',
  'Cooler Outlet Temp PID Auto Sp',
  'Cooler Outlet Temperature',
  'Flow Rate PID PV',
  'Loaded Auto Sp',
  'Quck Start Setting - Desired Flow Rate',
  'Stage 1 Suction Prs',
  'Stage 3 Discharge Prs',
  // Historical / other-catalog labels kept so older deploys still render.
  'Inlet Diff Pressure Reading',
  'Inlet Witches Hat DP Setpoint',
  'Skid - Shutdown',
  // Halfmann 1214 unit registers (2507/2504 series compressors)
  'Compressor Oil Pressure',
  'Compressor Oil Temperature',
  'Engine Load',
  'Engine Oil Pressure',
  'Engine Oil Temperature',
  'Number of Start Attempts per Hour',
  'Stage 1 Discharge Temperature',
  'Stage 2 Discharge Temperature',
  'System Voltage',
]

const KLONDIKE_DEFAULT_VISIBLE_LABELS = new Set([
  'Altronic Engine State',
  'Calculated Flow with Offset',
  'Compressor #1 Desire Flow SP For PID Murphy',
  'Compressor #2 Desire Flow SP For PID Murphy',
  'Compressor 1 Comms Loss',
  'Compressor 2 Comms Loss',
  'Derived Run Status',
  'Derived Stop Status',
  'Hour Meter',
  'Run Status Comp #1',
  'Run Status Comp #2',
  'Run Status Comp 1 2073',
  'Run Status Comp 2 2074',
  'Total Number Of Compressors',
  'Total Number Of Wellheads',
  'Well #1 Analog Output 1',
  'Well #2 Analog Output 2',
  'Well #3 Analog Output 3',
  'Well #4 Analog Output 4',
  'Well #5 Analog Output 5',
  'Wellhead #1 Calculated Desired Flow',
  'Wellhead #1 Choke Flow Priority #',
  'Wellhead #1 Choke Oil Priority #',
  'Wellhead #1 Flow Running Status Percent',
  'Wellhead #1 In Manual/Auto',
  'Wellhead #1 Injection Differential Prs From Customer PLC',
  'Wellhead #1 Injection Flow Rate From Customer PLC',
  'Wellhead #1 Injection Static Pressure From Customer PLC',
  'Wellhead #1 Injection Temp From Customer PLC',
  'WellHead #1 Running Status',
  "Wellhead #1 Yesterday's Total Flow",
  'Wellhead #1 Yesterdays Total Flow',
  'Wellhead #2 Calculated Desired Flow',
  'Wellhead #2 Choke Flow Priority #',
  'Wellhead #2 Choke Oil Priority #',
  'Wellhead #2 Flow Running Status Percent',
  'Wellhead #2 In Manual/Auto',
  'Wellhead #2 Injection Differential Prs From Customer PLC',
  'Wellhead #2 Injection Flow Rate From Customer PLC',
  'Wellhead #2 Injection Static Pressure From Customer PLC',
  'Wellhead #2 Injection Temp From Customer PLC',
  'WellHead #2 Running Status',
  'Wellhead #2 Setpoint From Customer PLC',
  "Wellhead #2 Yesterday's Total Flow",
  'Wellhead #2 Yesterdays Total Flow',
  'Wellhead #3 Calculated Desired Flow',
  'Wellhead #3 Choke Flow Priority #',
  'Wellhead #3 Choke Oil Priority #',
  'Wellhead #3 Flow Running Status Percent',
  'Wellhead #3 In Manual/Auto',
  'Wellhead #3 Injection Differential Prs From Customer PLC',
  'Wellhead #3 Injection Flow Rate From Customer PLC',
  'Wellhead #3 Injection Static Pressure From Customer PLC',
  'Wellhead #3 Injection Temp From Customer PLC',
  'WellHead #3 Running Status',
  'Wellhead #3 Setpoint From Customer PLC',
  "Wellhead #3 Yesterday's Total Flow",
  'Wellhead #3 Yesterdays Total Flow',
  'Wellhead #4 Calculated Desired Flow',
  'Wellhead #4 Choke Flow Priority #',
  'Wellhead #4 Choke Oil Priority #',
  'Wellhead #4 Flow Running Status Percent',
  'Wellhead #4 In Manual/Auto',
  'Wellhead #4 Injection Differential Prs From Customer PLC',
  'Wellhead #4 Injection Flow Rate From Customer PLC',
  'Wellhead #4 Injection Static Pressure From Customer PLC',
  'Wellhead #4 Injection Temp From Customer PLC',
  'Wellhead #4 Max Flow Rate',
  'WellHead #4 Running Status',
  'Wellhead #4 Setpoint From Customer PLC',
  "Wellhead #4 Yesterday's Total Flow",
  'Wellhead #4 Yesterdays Total Flow',
  'Wellhead #5 Calculated Desired Flow',
  'Wellhead #5 Choke Flow Priority #',
  'Wellhead #5 Choke Oil Priority #',
  'Wellhead #5 Flow Running Status Percent',
  'Wellhead #5 In Manual/Auto',
  'Wellhead #5 Injection Differential Prs From Customer PLC',
  'Wellhead #5 Injection Flow Rate From Customer PLC',
  'Wellhead #5 Injection Static Pressure From Customer PLC',
  'Wellhead #5 Injection Temp From Customer PLC',
  'Wellhead #5 Max Flow Rate',
  'WellHead #5 Running Status',
  'Wellhead #5 Setpoint From Customer PLC',
  "Wellhead #5 Yesterday's Total Flow",
  'Wellhead #5 Yesterdays Total Flow',
])

export async function loadAwiRegisterCatalog() {
  if (!registerCatalogPromise) {
    registerCatalogPromise = fetch(AWI_REGISTER_DOC)
      .then(res => res.arrayBuffer())
      .then(buffer => {
        const workbook = XLSX.read(buffer, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

        return dedupeRegisterCatalog(rows
          .slice(4)
          .filter(row => row[0] && row[1] && String(row[7] || '').includes('ReadOnly'))
          .map(row => buildRegisterMeta(row))
          .concat(buildSupplementalRegisterCatalog()))
      })
      .catch(() => [])
  }

  return registerCatalogPromise
}

function buildRegisterMeta(row) {
  const register = String(row[0]).trim()
  const label = String(row[1]).trim()
  const decimals = Number(row[12])
  const wellMatch = label.match(/^Well (\d+) /i)
  const wellNumber = wellMatch ? Number(wellMatch[1]) : null

  return {
    id: `${register}:${label}`,
    register,
    label,
    decimals: Number.isFinite(decimals) ? decimals : 3,
    wellNumber,
    groupId: wellNumber ? `well-${wellNumber}` : 'pad',
    groupLabel: wellNumber ? `Well ${wellNumber}` : 'Pad / Header',
  }
}

function createMeta(label, register, decimals = 3) {
  const wellMatch = label.match(/^Well(?:head)? #?(\d+)\b/i) || label.match(/^WellHead #(\d+)\b/i)
  const wellNumber = wellMatch ? Number(wellMatch[1]) : null

  return {
    id: `${register}:${label}`,
    register,
    label,
    decimals,
    wellNumber,
    groupId: wellNumber ? `well-${wellNumber}` : 'pad',
    groupLabel: wellNumber ? `Well ${wellNumber}` : 'Pad / Header',
  }
}

function buildSupplementalRegisterCatalog() {
  const items = [
    createMeta('Altronic Engine State', '400001', 0),
    createMeta('Calculated Flow with Offset', '460014', 3),
    createMeta('Compressor #1 Desire Flow SP For PID Murphy', '460002', 3),
    createMeta('Compressor #2 Desire Flow SP For PID Murphy', '460004', 3),
    createMeta('Compressor 1 Comms Loss', '460452', 0),
    createMeta('Compressor 2 Comms Loss', '460454', 0),
    createMeta('Communication Loss Debounce Timer', '460464', 0),
    createMeta('Communication Loss Override Active', '460460', 0),
    createMeta('Communication Loss Override Type', '460462', 0),
    createMeta('Derived Run Status', '420001', 0),
    createMeta('Derived Stop Status', '420002', 0),
    createMeta('Fault Indication', '400017', 0),
    createMeta('Flow Status Mode', '460140', 0),
    createMeta('Hour Meter', '400002', 0),
    createMeta('Panel ESD', '400015', 0),
    createMeta('Priority Mode', '460132', 0),
    createMeta('Run Status Comp #1', '400018', 0),
    createMeta('Run Status Comp #2', '400019', 0),
    createMeta('Run Status Comp 1 2073', '400020', 0),
    createMeta('Run Status Comp 2 2074', '400021', 0),
    createMeta('Total Number Of Compressors', '460998', 0),
    createMeta('Total Number Of Wellheads', '461000', 0),
    createMeta('WellHead PLC Comms Loss', '460450', 0),
    createMeta('Wellhead Control in Override', '460018', 0),
    createMeta('Wellhead Control in Override Comp Speed SP', '460020', 3),
    createMeta('Wellhead Priority Release', '460134', 0),
    createMeta('Wellhead 1 Override Position', '460466', 0),
    createMeta('Wellhead 2 Override Position', '460468', 0),
    createMeta('Wellhead 3 Override Position', '460470', 0),
    createMeta('Wellhead 4 Override Position', '460472', 0),
    createMeta('Wellhead 5 Override Position', '460474', 0),
  ]

  for (let well = 1; well <= 5; well += 1) {
    items.push(createMeta(`Wellhead #${well} Calculated Desired Flow`, String(460050 + (well - 1) * 2), 3))
    items.push(createMeta(`Wellhead #${well} Choke Flow Priority #`, String(461002 + (well - 1) * 2), 0))
    items.push(createMeta(`Wellhead #${well} Choke Oil Priority #`, String(461036 + (well - 1) * 2), 0))
    items.push(createMeta(`Wellhead #${well} Flow Running Status Percent`, String(460146 + (well - 1) * 6), 0))
    items.push(createMeta(`Wellhead #${well} In Manual/Auto`, String(460026 + (well - 1) * 2), 0))
    items.push(createMeta(`Wellhead #${well} Injection Differential Prs From Customer PLC`, String(460216 + (well - 1) * 14), 3))
    items.push(createMeta(`Wellhead #${well} Injection Flow Rate From Customer PLC`, String(460212 + (well - 1) * 14), 3))
    items.push(createMeta(`Wellhead #${well} Injection Static Pressure From Customer PLC`, String(460214 + (well - 1) * 14), 3))
    items.push(createMeta(`Wellhead #${well} Injection Temp From Customer PLC`, String(460218 + (well - 1) * 14), 3))
    items.push(createMeta(`WellHead #${well} Running Status`, String(460074 + (well - 1) * 2), 0))
    items.push(createMeta(`Wellhead #${well} Setpoint From Customer PLC`, String(460220 + (well - 1) * 14), 3))
    items.push(createMeta(`Wellhead #${well} Yesterday's Total Flow`, String(460222 + (well - 1) * 14), 3))
    items.push(createMeta(`Wellhead #${well} Yesterdays Total Flow`, String(460222 + (well - 1) * 14), 3))
  }

  items.push(createMeta('Wellhead #4 Max Flow Rate', '461140', 3))
  items.push(createMeta('Wellhead #5 Max Flow Rate', '461142', 3))

  return items
}

function dedupeRegisterCatalog(items) {
  const seen = new Set()
  return items.filter((item) => {
    const key = `${item.register}:${item.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function parseLiveDatapoints(data) {
  if (!data?.datapoints) return {}
  const result = {}
  for (const dp of data.datapoints) {
    // Murphy's MLink API publishes the human-readable label under any
    // of `alias`, `desc`, `dataSourceName`, `Name`, or `name`
    // depending on device firmware / catalog version. The prior
    // implementation only checked alias+desc, which silently
    // collapsed every datapoint under a single `undefined` key on
    // payloads that use dataSourceName — exactly the symptom behind
    // the compressor flow / desired-flow reading "No Data" even
    // though the device was online (RPM happened to have `alias`
    // populated, so isRunning worked, but everything else collapsed).
    const alias = dp.alias || dp.desc || dp.dataSourceName || dp.Name || dp.name
    if (!alias) continue
    // Normalize value extraction too — some payload shapes nest the
    // most-recent reading in `values[0]` rather than exposing it as
    // `value` directly. Match the server-side parser in
    // server/mlinkHistory.js so frontend + backend agree on what's
    // in the payload.
    const value = dp.value ?? (Array.isArray(dp.values) ? dp.values[0] : undefined)
    const dpObj = {
      value,
      units: dp.units || dp.unit,
      desc: dp.desc || dp.dataSourceName,
    }
    // Index by alias (primary key used by MLink cloud)
    result[alias] = dpObj
    // Also index by the canonical desc name so lookups using the full
    // register name (e.g. "Wellhead #1 Injection Flow Rate From Customer PLC")
    // resolve even when Murphy published the data under a shorter alias
    // (e.g. "Well #1 Flow Rate"). Without this, findRegisterDatapoint
    // falls through to normalized matching on every lookup.
    const desc = dp.desc || dp.dataSourceName
    if (desc && desc !== alias) {
      result[desc] = dpObj
    }
  }
  return result
}

export function isValidLiveRegisterValue(value) {
  if (value == null) return false
  if (typeof value === 'string' && value.trim() === '') return false

  const numeric = Number(value)
  if (Number.isFinite(numeric)) return true

  const normalized = String(value).trim().toLowerCase()
  return normalized !== '' && normalized !== 'nan' && normalized !== 'null' && normalized !== 'undefined'
}

export function isDefaultLiveRegisterVisible(meta) {
  return KLONDIKE_DEFAULT_VISIBLE_LABELS.has(meta.label)
}

export function findRegisterDatapoint(dataMap, meta) {
  const candidates = buildCandidateLabels(meta.label)

  for (const key of candidates) {
    if (dataMap[key] && isValidLiveRegisterValue(dataMap[key].value)) {
      return { ...dataMap[key], keyUsed: key }
    }
  }

  const normalizedCandidates = candidates.map(normalizeLabel)
  for (const [key, datapoint] of Object.entries(dataMap)) {
    if (!isValidLiveRegisterValue(datapoint.value)) continue
    if (normalizedCandidates.includes(normalizeLabel(key))) {
      return { ...datapoint, keyUsed: key }
    }
  }

  return null
}

export function getVisibleLiveRegisters(dataMap, catalog, visibilitySettings = {}) {
  return catalog
    .map(meta => {
      const datapoint = findRegisterDatapoint(dataMap, meta)
      if (!datapoint) return null

      const enabled = visibilitySettings[meta.id]
      const isVisible = enabled == null ? isDefaultLiveRegisterVisible(meta) : !!enabled

      return isVisible ? { ...meta, datapoint } : null
    })
    .filter(Boolean)
}

export function getDetectedLiveRegisters(dataMap, catalog) {
  return catalog
    .map(meta => {
      const datapoint = findRegisterDatapoint(dataMap, meta)
      return datapoint ? { ...meta, datapoint } : null
    })
    .filter(Boolean)
}

export function getCompressorCatalog() {
  return COMPRESSOR_DEFAULT_VISIBLE_LABELS.map((label) => createMeta(label, label, inferCompressorDecimals(label)))
}

export function getVisibleCompressorRegisters(dataMap, visibilitySettings = {}) {
  return getCompressorCatalog()
    .map(meta => {
      const datapoint = findRegisterDatapoint(dataMap, meta)
      if (!datapoint) return null

      const enabled = visibilitySettings[meta.label]
      const isVisible = enabled == null ? COMPRESSOR_DEFAULT_VISIBLE_LABELS.includes(meta.label) : !!enabled
      return isVisible ? { ...meta, datapoint } : null
    })
    .filter(Boolean)
}

export function getDetectedCompressorRegisters(...maps) {
  const dataMaps = maps.filter(Boolean)
  return getCompressorCatalog().filter((meta) =>
    dataMaps.some((dataMap) => findRegisterDatapoint(dataMap, meta)),
  )
}

export function formatLiveRegisterValue(meta, datapoint) {
  const rawValue = datapoint?.value
  const numeric = Number(rawValue)

  if (meta.label.endsWith('Manual/Auto') && Number.isFinite(numeric)) {
    if (numeric === 0) return 'Manual'
    if (numeric === 1) return 'Auto'
  }

  if (Number.isFinite(numeric)) {
    const decimals = Math.max(0, Math.min(meta.decimals ?? 3, 3))
    return numeric.toFixed(decimals)
  }

  return String(rawValue)
}

function buildCandidateLabels(label) {
  const candidates = new Set([label])
  const wellMatch = label.match(/^Well (\d+) (.+)$/i)
  const wellheadMatch = label.match(/^Wellhead #(\d+) (.+)$/i) || label.match(/^WellHead #(\d+) (.+)$/i)

  if (label === 'Compressor Speed') {
    candidates.add('Driver Speed')
    candidates.add('RPM')
    candidates.add('Engine Speed')          // Halfmann AWI units publish under this name
  }

  if (label === 'Stage 1 Suction Prs') {
    candidates.add('Suction Pressure')
    candidates.add('Stage 1 Suction Pressure')
  }

  if (label === 'Stage 3 Discharge Prs') {
    candidates.add('Discharge Pressure')
    candidates.add('Stage 3 Discharge Pressure')
  }

  if (label === '3rd Stage Discharge Temperature') {
    candidates.add('Discharge Temperature')
    candidates.add('3rd Stage Discharge Temp')
  }

  // Halfmann-unit label variants — Murphy portal uses these names/typos
  if (label === 'System Voltage') {
    candidates.add('System Volts')
  }

  if (label === 'Engine Oil Pressure') {
    candidates.add('Engine Oil Presssure')  // Murphy portal typo (3 s's) on Halfmann units
  }

  if (label === 'Stage 1 Discharge Temperature') {
    candidates.add('1st Stage Discharge Temperature')
  }

  if (label === 'Stage 2 Discharge Temperature') {
    candidates.add('2nd Stage Discharge Temperature')
  }

  if (label === 'Flow Rate PID PV') {
    // The CAN CCP live payload from Centurion C5 compressors names
    // this register plain 'Flow Rate' (register 400656). Keep it as a
    // first-class alias so any consumer that queries the canonical
    // 'Flow Rate PID PV' still resolves when the live feed only has
    // 'Flow Rate'. Without this, the Compressor Flow Match KPI and any
    // downstream read of compressor actual flow fall through to null.
    candidates.add('Flow Rate')
    candidates.add('Flow Rate PV')
    candidates.add('Flow PID PV')
    candidates.add('Compressor Flow Rate PID PV')
  }

  const compressorDesiredMatch = label.match(/^Compressor #?(\d+) Desir(?:e|ed) Flow SP For PID Murphy$/i)
  if (compressorDesiredMatch) {
    const compressorNumber = compressorDesiredMatch[1]
    candidates.add(`Compressor #${compressorNumber} Desire Flow SP For PID Murphy`)
    candidates.add(`Compressor #${compressorNumber} Desired Flow SP For PID Murphy`)
    candidates.add(`Compressor ${compressorNumber} Desire Flow SP For PID Murphy`)
    candidates.add(`Compressor ${compressorNumber} Desired Flow SP For PID Murphy`)
  }

  if (wellMatch) {
    const wellNumber = wellMatch[1]
    const suffix = wellMatch[2]

    candidates.add(`Wellhead #${wellNumber} ${suffix}`)
    candidates.add(`Well #${wellNumber} ${suffix}`)

    if (suffix === 'Injection Gas Flow Rate') {
      candidates.add(`Well #${wellNumber} Flow Rate`)
      candidates.add(`Wellhead #${wellNumber} Injection Gas Flow Rate`)
      candidates.add(`Wellhead #${wellNumber} Injection Flow Rate From Customer PLC`)
    }

    if (suffix === 'Injection Static Pressure') {
      candidates.add(`Wellhead #${wellNumber} Injection Static Pressure`)
      candidates.add(`Wellhead #${wellNumber} Injection Static Pressure From Customer PLC`)
    }

    if (suffix === 'Injection Differential Pressure') {
      candidates.add(`Wellhead #${wellNumber} Injection Differential Pressure`)
      candidates.add(`Wellhead #${wellNumber} Injection Differential Prs`)
      candidates.add(`Wellhead #${wellNumber} Injection Differential Prs From Customer PLC`)
    }

    if (suffix === 'Injection Temp') {
      candidates.add(`Wellhead #${wellNumber} Injection Temp`)
      candidates.add(`Wellhead #${wellNumber} Injection Temp From Customer PLC`)
    }

    if (suffix === 'Yesterdays Flow') {
      candidates.add(`Wellhead #${wellNumber} Yesterdays Flow`)
      candidates.add(`Wellhead #${wellNumber} Yesterdays Total Flow`)
      candidates.add(`Wellhead #${wellNumber} Yesterday's Total Flow`)
      candidates.add(`Well ${wellNumber} Yesterdays Flow`)
    }

    if (suffix === 'Manual/Auto') {
      candidates.add(`Wellhead #${wellNumber} Manual/Auto`)
      candidates.add(`Wellhead #${wellNumber} In Manual/Auto`)
      candidates.add(`Well ${wellNumber} Manual/Auto`)
    }

    if (suffix === 'Choke Position') {
      candidates.add(`Wellhead #${wellNumber} Choke Position`)
      candidates.add(`Well ${wellNumber} Choke Position`)
      candidates.add(`Well #${wellNumber} Analog Output ${wellNumber}`)
    }
  }

  if (wellheadMatch) {
    const wellNumber = wellheadMatch[1]
    const suffix = wellheadMatch[2]

    candidates.add(`Wellhead #${wellNumber} ${suffix}`)
    candidates.add(`WellHead #${wellNumber} ${suffix}`)
    candidates.add(`Well ${wellNumber} ${suffix}`)

    if (suffix === 'Calculated Desired Flow') {
      candidates.add(`Wellhead #${wellNumber} Calculated Desired Flow`)
    }

    if (suffix === 'Running Status') {
      candidates.add(`WellHead #${wellNumber} Running Status`)
      candidates.add(`Wellhead #${wellNumber} Running Status`)
    }

    if (suffix === 'PID Min Output') {
      candidates.add(`Wellhead #${wellNumber} PID Min Output`)
    }

    if (suffix === 'Setpoint' || suffix === 'Setpoint From Customer PLC') {
      candidates.add(`Wellhead #${wellNumber} Setpoint From Customer PLC`)
      candidates.add(`Well ${wellNumber} Setpoint From Customer PLC`)
    }
  }

  return [...candidates]
}

function normalizeLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function inferCompressorDecimals(label) {
  if (/shutdown/i.test(label)) return 0
  if (/speed/i.test(label)) return 0
  return 2
}
