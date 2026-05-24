const defineSetting = (defaultValue, config) => ({
  defaultValue,
  ...config,
})

export const DERIVED_TRIGGER_SETTINGS_SCHEMA = {
  wellFlow: {
    label: 'Well Flow Compliance',
    settings: {
      allWellsMeetingFlowTolerancePct: defineSetting(5, {
        label: 'All Wells Meeting Flow Tolerance %',
        description: 'Tolerance band used when deciding whether all wells are meeting target flow.',
        unit: '%',
        min: 0.5,
        max: 15,
        step: 0.5,
        type: 'number',
      }),
      individualWellMeetingFlowTolerancePct: defineSetting(5, {
        label: 'Individual Well Meeting Flow Tolerance %',
        description: 'Tolerance band used when evaluating a single well against target.',
        unit: '%',
        min: 0.5,
        max: 15,
        step: 0.5,
        type: 'number',
      }),
      wellUnderTargetThresholdPct: defineSetting(2, {
        label: 'Well Under Target Threshold %',
        description: 'Percent below target before a well is classified as under target.',
        unit: '%',
        min: 0.5,
        max: 25,
        step: 0.5,
        type: 'number',
      }),
      wellOverTargetThresholdPct: defineSetting(2, {
        label: 'Well Over Target Threshold %',
        description: 'Percent above target before a well is classified as over target.',
        unit: '%',
        min: 0.5,
        max: 25,
        step: 0.5,
        type: 'number',
      }),
      wellSevereUnderTargetThresholdPct: defineSetting(8, {
        label: 'Well Severe Under Target Threshold %',
        description: 'Percent below target used to classify a severe shortfall.',
        unit: '%',
        min: 1,
        max: 40,
        step: 0.5,
        type: 'number',
      }),
      wellSevereOverTargetThresholdPct: defineSetting(8, {
        label: 'Well Severe Over Target Threshold %',
        description: 'Percent above target used to classify a severe overshoot.',
        unit: '%',
        min: 1,
        max: 40,
        step: 0.5,
        type: 'number',
      }),
      minimumValidDesiredFlowMmscfd: defineSetting(0.05, {
        label: 'Minimum Valid Desired Flow MMSCFD',
        description: 'Desired flow below this value is treated as effectively unavailable for compliance scoring.',
        unit: 'MMSCFD',
        min: 0,
        max: 5,
        step: 0.01,
        type: 'number',
      }),
      ignoreWellIfDesiredFlowEqualsZero: defineSetting(true, {
        label: 'Ignore Well If Desired Flow Equals Zero',
        description: 'When enabled, wells with a zero desired rate are excluded from compliance scoring.',
        unit: 'boolean',
        type: 'boolean',
      }),
      requiredWellsMeetingCount: defineSetting(5, {
        label: 'Required Wells Meeting Count',
        description: 'How many wells must be meeting rate for the pad-level well compliance signal to pass.',
        unit: 'count',
        min: 0,
        max: 5,
        step: 1,
        type: 'integer',
      }),
    },
  },
  siteFlow: {
    label: 'Site Flow Compliance',
    settings: {
      siteInjectionOnTargetTolerancePct: defineSetting(5, {
        label: 'Site Injection On Target Tolerance %',
        description: 'Percent tolerance used for pad-level injection on-target scoring.',
        unit: '%',
        min: 0.5,
        max: 20,
        step: 0.5,
        type: 'number',
      }),
      siteFlowDeficitThresholdMmscfd: defineSetting(0.05, {
        label: 'Site Flow Deficit Threshold MMSCFD',
        description: 'Minimum site flow deficit before the pad is treated as short of target.',
        unit: 'MMSCFD',
        min: 0,
        max: 5,
        step: 0.01,
        type: 'number',
      }),
      siteFlowExcessThresholdMmscfd: defineSetting(0.05, {
        label: 'Site Flow Excess Threshold MMSCFD',
        description: 'Minimum site flow excess before the pad is treated as over target.',
        unit: 'MMSCFD',
        min: 0,
        max: 5,
        step: 0.01,
        type: 'number',
      }),
      siteFlowAlignmentScoreDeadbandPct: defineSetting(3, {
        label: 'Site Flow Alignment Score Deadband %',
        description: 'Deadband used before site flow mismatch begins reducing alignment score.',
        unit: '%',
        min: 0,
        max: 15,
        step: 0.5,
        type: 'number',
      }),
    },
  },
  compressorDispatch: {
    label: 'Compressor Dispatch',
    settings: {
      compressorCommandMatchTolerancePct: defineSetting(5, {
        label: 'Compressor Command Match Tolerance %',
        description: 'Percent mismatch allowed before a compressor is treated as not meeting command.',
        unit: '%',
        min: 1,
        max: 20,
        step: 0.5,
        type: 'number',
      }),
      compressorMinorMismatchPct: defineSetting(3, {
        label: 'Compressor Minor Mismatch %',
        description: 'Dispatch mismatch at or below this level is treated as normal deadband.',
        unit: '%',
        min: 0.5,
        max: 15,
        step: 0.5,
        type: 'number',
      }),
      compressorModerateMismatchPct: defineSetting(7, {
        label: 'Compressor Moderate Mismatch %',
        description: 'Dispatch mismatch above the minor band enters monitor/review territory.',
        unit: '%',
        min: 1,
        max: 25,
        step: 0.5,
        type: 'number',
      }),
      compressorSevereMismatchPct: defineSetting(12, {
        label: 'Compressor Severe Mismatch %',
        description: 'Dispatch mismatch above this level is severe and may justify investigation.',
        unit: '%',
        min: 2,
        max: 40,
        step: 0.5,
        type: 'number',
      }),
      requiredCompressorsMeetingCount: defineSetting(4, {
        label: 'Required Compressors Meeting Count',
        description: 'How many active compressors must meet command for the compressor-meeting signal to pass.',
        unit: 'count',
        min: 0,
        max: 5,
        step: 1,
        type: 'integer',
      }),
      compressorDispatchPersistenceSeconds: defineSetting(120, {
        label: 'Compressor Dispatch Persistence Seconds',
        description: 'Dispatch mismatch must persist this many seconds before the state is allowed to flip.',
        unit: 'sec',
        min: 0,
        max: 1800,
        step: 5,
        type: 'integer',
      }),
      compressorCapacityMarginWarningMmscfd: defineSetting(0.1, {
        label: 'Compressor Capacity Margin Warning MMSCFD',
        description: 'Margin below this level triggers a compressor-capacity warning state.',
        unit: 'MMSCFD',
        min: 0,
        max: 10,
        step: 0.01,
        type: 'number',
      }),
      compressorCapacityMarginCriticalMmscfd: defineSetting(0.03, {
        label: 'Compressor Capacity Margin Critical MMSCFD',
        description: 'Margin below this level is treated as a critical compressor-capacity constraint.',
        unit: 'MMSCFD',
        min: 0,
        max: 10,
        step: 0.01,
        type: 'number',
      }),
    },
  },
  recyclePressure: {
    label: 'Recycle / Pressure',
    settings: {
      recycleValveAllowedPositionPct: defineSetting(0, {
        label: 'Recycle Valve Allowed Position %',
        description: 'Target recycle position during normal stable operation.',
        unit: '%',
        min: 0,
        max: 100,
        step: 0.5,
        type: 'number',
      }),
      recycleActiveThresholdPct: defineSetting(5, {
        label: 'Recycle Active Threshold %',
        description: 'Recycle valve position above this value is treated as recycle active.',
        unit: '%',
        min: 0,
        max: 100,
        step: 0.5,
        type: 'number',
      }),
      dischargePressureWarningPsi: defineSetting(1225, {
        label: 'Discharge Pressure Warning PSI',
        description: 'Site discharge pressure above this level triggers a warning condition.',
        unit: 'PSI',
        min: 0,
        max: 5000,
        step: 1,
        type: 'number',
      }),
      dischargePressureCriticalPsi: defineSetting(1250, {
        label: 'Discharge Pressure Critical PSI',
        description: 'Site discharge pressure above this level is critical.',
        unit: 'PSI',
        min: 0,
        max: 5000,
        step: 1,
        type: 'number',
      }),
      staticHeaderPressureLowWarningPsi: defineSetting(40, {
        label: 'Static Header Pressure Low Warning PSI',
        description: 'Static header pressure below this level is treated as a low-pressure warning.',
        unit: 'PSI',
        min: 0,
        max: 5000,
        step: 1,
        type: 'number',
      }),
      staticHeaderPressureLowCriticalPsi: defineSetting(35, {
        label: 'Static Header Pressure Low Critical PSI',
        description: 'Static header pressure below this level is critical.',
        unit: 'PSI',
        min: 0,
        max: 5000,
        step: 1,
        type: 'number',
      }),
      dischargeOverrideActiveThreshold: defineSetting(0.5, {
        label: 'Discharge Override Active Threshold',
        description: 'Threshold used to interpret the DE4000 override latch as active.',
        unit: 'signal',
        min: 0,
        max: 10,
        step: 0.5,
        type: 'number',
      }),
      compressorSlowdownDetectionThreshold: defineSetting(0.5, {
        label: 'Compressor Slowdown Detection Threshold',
        description: 'Threshold used to detect compressor protective slowdown state.',
        unit: 'signal',
        min: 0,
        max: 10,
        step: 0.5,
        type: 'number',
      }),
    },
  },
  chokeRestriction: {
    label: 'Choke / Well Restriction Logic',
    settings: {
      highChokeThresholdPct: defineSetting(85, {
        label: 'High Choke Threshold %',
        description: 'Choke above this level is treated as high.',
        unit: '%',
        min: 0,
        max: 100,
        step: 1,
        type: 'number',
      }),
      chokeSaturationThresholdPct: defineSetting(90, {
        label: 'Choke Saturation Threshold %',
        description: 'Choke above this level is treated as saturated.',
        unit: '%',
        min: 0,
        max: 100,
        step: 1,
        type: 'number',
      }),
      lowChokeThresholdPct: defineSetting(15, {
        label: 'Low Choke Threshold %',
        description: 'Choke below this level is treated as materially closed.',
        unit: '%',
        min: 0,
        max: 100,
        step: 1,
        type: 'number',
      }),
      restrictedWellFlowMatchThresholdPct: defineSetting(95, {
        label: 'Restricted Well Flow Match Threshold %',
        description: 'Flow match below this level may support a restricted-well classification.',
        unit: '%',
        min: 50,
        max: 100,
        step: 0.5,
        type: 'number',
      }),
      restrictedWellPersistenceSeconds: defineSetting(120, {
        label: 'Restricted Well Persistence Seconds',
        description: 'Restricted-well indicators must persist this many seconds before the classification is active.',
        unit: 'sec',
        min: 0,
        max: 1800,
        step: 5,
        type: 'integer',
      }),
      pressureLimitedWellClassificationEnabled: defineSetting(true, {
        label: 'Pressure-Limited Well Classification Enabled',
        description: 'Enable pressure-limited classification logic for wells.',
        unit: 'boolean',
        type: 'boolean',
      }),
      pressureLimitedWellChokeThresholdPct: defineSetting(90, {
        label: 'Pressure-Limited Well Choke Threshold %',
        description: 'High choke threshold used for pressure-limited well classification.',
        unit: '%',
        min: 0,
        max: 100,
        step: 1,
        type: 'number',
      }),
      pressureLimitedFlowMatchThresholdPct: defineSetting(95, {
        label: 'Pressure-Limited Flow Match Threshold %',
        description: 'Flow match threshold used for pressure-limited well classification.',
        unit: '%',
        min: 50,
        max: 100,
        step: 0.5,
        type: 'number',
      }),
    },
  },
  stabilityScores: {
    label: 'Stability Scores',
    settings: {
      overallPadStableScoreMinimum: defineSetting(90, {
        label: 'Overall Pad Stable Score Minimum',
        description: 'Overall score at or above this value is treated as stable.',
        unit: 'score',
        min: 0,
        max: 100,
        step: 1,
        type: 'integer',
      }),
      overallPadWatchScoreMinimum: defineSetting(75, {
        label: 'Overall Pad Watch Score Minimum',
        description: 'Overall score at or above this value enters watch state.',
        unit: 'score',
        min: 0,
        max: 100,
        step: 1,
        type: 'integer',
      }),
      compressorStableScoreMinimum: defineSetting(90, {
        label: 'Compressor Stable Score Minimum',
        description: 'Compressor score at or above this value is stable.',
        unit: 'score',
        min: 0,
        max: 100,
        step: 1,
        type: 'integer',
      }),
      compressorWatchScoreMinimum: defineSetting(75, {
        label: 'Compressor Watch Score Minimum',
        description: 'Compressor score at or above this value enters watch state.',
        unit: 'score',
        min: 0,
        max: 100,
        step: 1,
        type: 'integer',
      }),
      wellStableScoreMinimum: defineSetting(90, {
        label: 'Well Stable Score Minimum',
        description: 'Well score at or above this value is stable.',
        unit: 'score',
        min: 0,
        max: 100,
        step: 1,
        type: 'integer',
      }),
      wellWatchScoreMinimum: defineSetting(75, {
        label: 'Well Watch Score Minimum',
        description: 'Well score at or above this value enters watch state.',
        unit: 'score',
        min: 0,
        max: 100,
        step: 1,
        type: 'integer',
      }),
      minimumDataConfidenceRequiredPct: defineSetting(70, {
        label: 'Minimum Data Confidence Required %',
        description: 'Minimum data confidence required before aggressive recommendations are allowed.',
        unit: '%',
        min: 0,
        max: 100,
        step: 1,
        type: 'integer',
      }),
    },
  },
  recommendationRules: {
    label: 'Optimization Recommendation Rules',
    settings: {
      requireMagnitude: defineSetting(true, {
        label: 'Require Magnitude',
        description: 'Recommendations require a meaningful magnitude threshold before suggesting a change.',
        unit: 'boolean',
        type: 'boolean',
      }),
      requirePersistence: defineSetting(true, {
        label: 'Require Persistence',
        description: 'Recommendations require persistence or event support before suggesting a change.',
        unit: 'boolean',
        type: 'boolean',
      }),
      requireConsequence: defineSetting(true, {
        label: 'Require Consequence',
        description: 'Recommendations require site consequence before suggesting a change.',
        unit: 'boolean',
        type: 'boolean',
      }),
      minimumConfidenceToRecommendChangePct: defineSetting(75, {
        label: 'Minimum Confidence To Recommend Change %',
        description: 'Minimum confidence required before the advisor recommends an increase or decrease.',
        unit: '%',
        min: 0,
        max: 100,
        step: 1,
        type: 'integer',
      }),
      minimumConfidenceToInvestigatePct: defineSetting(65, {
        label: 'Minimum Confidence To Investigate %',
        description: 'Minimum confidence required before the advisor recommends investigation.',
        unit: '%',
        min: 0,
        max: 100,
        step: 1,
        type: 'integer',
      }),
      minimumConfidenceToMonitorPct: defineSetting(50, {
        label: 'Minimum Confidence To Monitor %',
        description: 'Minimum confidence required before the advisor recommends monitor-only status.',
        unit: '%',
        min: 0,
        max: 100,
        step: 1,
        type: 'integer',
      }),
      holdBiasEnabled: defineSetting(true, {
        label: 'Hold Bias Enabled',
        description: 'Bias the optimization advisor toward HOLD when evidence is weak or contradictory.',
        unit: 'boolean',
        type: 'boolean',
      }),
      stablePadForcesHold: defineSetting(true, {
        label: 'Stable Pad Forces Hold',
        description: 'When enabled, a stable pad automatically forces a HOLD recommendation.',
        unit: 'boolean',
        type: 'boolean',
      }),
    },
  },
  eventHistory: {
    label: 'Event History / Runtime Reporting',
    settings: {
      lookbackWindowDays: defineSetting(14, {
        label: 'Lookback Window Days',
        description: 'How far back the optimization advisor looks for retained historical evidence.',
        unit: 'days',
        min: 1,
        max: 180,
        step: 1,
        type: 'integer',
      }),
      minimumEventCountRequired: defineSetting(1, {
        label: 'Minimum Event Count Required',
        description: 'Minimum retained events required before an event-supported recommendation is allowed.',
        unit: 'count',
        min: 0,
        max: 100,
        step: 1,
        type: 'integer',
      }),
      eventPersistenceSeconds: defineSetting(120, {
        label: 'Event Persistence Seconds',
        description: 'Minimum persistence required before an event is counted as real.',
        unit: 'sec',
        min: 0,
        max: 3600,
        step: 5,
        type: 'integer',
      }),
      maxTelemetryGapSeconds: defineSetting(5, {
        label: 'Max Telemetry Gap Seconds',
        description: 'Gaps larger than this break runtime continuity for event and KPI calculations.',
        unit: 'sec',
        min: 1,
        max: 600,
        step: 1,
        type: 'integer',
      }),
      runtimeReportTolerancePct: defineSetting(98, {
        label: 'Runtime Report Tolerance %',
        description: 'Match percentage required to count a sample as meeting desired rate in runtime reports.',
        unit: '%',
        min: 50,
        max: 100,
        step: 0.5,
        type: 'number',
      }),
      monthlyKpiComplianceTolerancePct: defineSetting(98, {
        label: 'Monthly KPI Compliance Tolerance %',
        description: 'Month-to-date KPI tolerance used when calculating compliance percentages.',
        unit: '%',
        min: 50,
        max: 100,
        step: 0.5,
        type: 'number',
      }),
      priorityProtectionTolerancePct: defineSetting(98, {
        label: 'Priority Protection Tolerance %',
        description: 'Target match threshold used when scoring priority well protection during constraint.',
        unit: '%',
        min: 50,
        max: 100,
        step: 0.5,
        type: 'number',
      }),
    },
  },
}

export function listDerivedSettingDefinitions() {
  return Object.entries(DERIVED_TRIGGER_SETTINGS_SCHEMA).flatMap(([groupKey, group]) =>
    Object.entries(group.settings).map(([settingKey, setting]) => ({
      groupKey,
      settingKey,
      path: `${groupKey}.${settingKey}`,
      groupLabel: group.label,
      ...setting,
    })),
  )
}

export function buildDefaultDerivedTriggerSettings() {
  return Object.fromEntries(
    Object.entries(DERIVED_TRIGGER_SETTINGS_SCHEMA).map(([groupKey, group]) => [
      groupKey,
      Object.fromEntries(
        Object.entries(group.settings).map(([settingKey, setting]) => [settingKey, setting.defaultValue]),
      ),
    ]),
  )
}

export const DEFAULT_DERIVED_TRIGGER_SETTINGS = buildDefaultDerivedTriggerSettings()

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function coerceSettingValue(rawValue, definition) {
  if (definition.type === 'boolean') return Boolean(rawValue)
  if (definition.type === 'integer') {
    const numeric = Number(rawValue)
    return Number.isFinite(numeric) ? Math.round(numeric) : definition.defaultValue
  }
  if (definition.type === 'number') {
    const numeric = Number(rawValue)
    return Number.isFinite(numeric) ? numeric : definition.defaultValue
  }
  return rawValue ?? definition.defaultValue
}

export function mergeDerivedTriggerSettings(input = {}) {
  const merged = deepClone(DEFAULT_DERIVED_TRIGGER_SETTINGS)
  for (const { groupKey, settingKey, defaultValue } of listDerivedSettingDefinitions()) {
    const nextValue = input?.[groupKey]?.[settingKey]
    if (nextValue === undefined) {
      merged[groupKey][settingKey] = defaultValue
      continue
    }
    const definition = DERIVED_TRIGGER_SETTINGS_SCHEMA[groupKey].settings[settingKey]
    merged[groupKey][settingKey] = coerceSettingValue(nextValue, definition)
  }
  return merged
}

function validateCrossThresholds(settings, errors) {
  const push = (path, message) => errors.push({ path, message })
  const wellFlow = settings.wellFlow
  if (wellFlow.wellUnderTargetThresholdPct > wellFlow.wellSevereUnderTargetThresholdPct) {
    push('wellFlow.wellUnderTargetThresholdPct', 'Well under-target threshold cannot exceed severe under-target threshold.')
  }
  if (wellFlow.wellOverTargetThresholdPct > wellFlow.wellSevereOverTargetThresholdPct) {
    push('wellFlow.wellOverTargetThresholdPct', 'Well over-target threshold cannot exceed severe over-target threshold.')
  }

  const compressor = settings.compressorDispatch
  if (compressor.compressorMinorMismatchPct > compressor.compressorModerateMismatchPct) {
    push('compressorDispatch.compressorMinorMismatchPct', 'Compressor minor mismatch cannot exceed moderate mismatch.')
  }
  if (compressor.compressorModerateMismatchPct > compressor.compressorSevereMismatchPct) {
    push('compressorDispatch.compressorModerateMismatchPct', 'Compressor moderate mismatch cannot exceed severe mismatch.')
  }
  if (compressor.compressorCapacityMarginWarningMmscfd < compressor.compressorCapacityMarginCriticalMmscfd) {
    push('compressorDispatch.compressorCapacityMarginWarningMmscfd', 'Capacity margin warning must be greater than or equal to critical margin.')
  }

  const recycle = settings.recyclePressure
  if (recycle.dischargePressureWarningPsi > recycle.dischargePressureCriticalPsi) {
    push('recyclePressure.dischargePressureWarningPsi', 'Discharge pressure warning cannot exceed critical pressure.')
  }
  if (recycle.staticHeaderPressureLowWarningPsi < recycle.staticHeaderPressureLowCriticalPsi) {
    push('recyclePressure.staticHeaderPressureLowWarningPsi', 'Static header low warning must be greater than or equal to static header critical pressure.')
  }
  if (recycle.recycleValveAllowedPositionPct > recycle.recycleActiveThresholdPct) {
    push('recyclePressure.recycleValveAllowedPositionPct', 'Recycle allowed position cannot exceed the recycle active threshold.')
  }

  const choke = settings.chokeRestriction
  if (choke.highChokeThresholdPct > choke.chokeSaturationThresholdPct) {
    push('chokeRestriction.highChokeThresholdPct', 'High choke threshold cannot exceed choke saturation threshold.')
  }

  const stability = settings.stabilityScores
  if (stability.overallPadWatchScoreMinimum > stability.overallPadStableScoreMinimum) {
    push('stabilityScores.overallPadWatchScoreMinimum', 'Overall pad watch score cannot exceed the stable score minimum.')
  }
  if (stability.compressorWatchScoreMinimum > stability.compressorStableScoreMinimum) {
    push('stabilityScores.compressorWatchScoreMinimum', 'Compressor watch score cannot exceed the stable score minimum.')
  }
  if (stability.wellWatchScoreMinimum > stability.wellStableScoreMinimum) {
    push('stabilityScores.wellWatchScoreMinimum', 'Well watch score cannot exceed the stable score minimum.')
  }

  const recommendation = settings.recommendationRules
  if (recommendation.minimumConfidenceToMonitorPct > recommendation.minimumConfidenceToInvestigatePct) {
    push('recommendationRules.minimumConfidenceToMonitorPct', 'Minimum confidence to monitor cannot exceed minimum confidence to investigate.')
  }
  if (recommendation.minimumConfidenceToInvestigatePct > recommendation.minimumConfidenceToRecommendChangePct) {
    push('recommendationRules.minimumConfidenceToInvestigatePct', 'Minimum confidence to investigate cannot exceed minimum confidence to recommend change.')
  }
}

export function validateDerivedTriggerSettings(input = {}) {
  const merged = mergeDerivedTriggerSettings(input)
  const errors = []

  for (const definition of listDerivedSettingDefinitions()) {
    const value = merged[definition.groupKey][definition.settingKey]
    if (definition.type !== 'boolean' && !Number.isFinite(value)) {
      errors.push({ path: definition.path, message: `${definition.label} must be a valid number.` })
      continue
    }
    if ((definition.type === 'number' || definition.type === 'integer') && value < definition.min) {
      errors.push({ path: definition.path, message: `${definition.label} cannot be below ${definition.min}${definition.unit && definition.unit !== 'boolean' ? ` ${definition.unit}` : ''}.` })
    }
    if ((definition.type === 'number' || definition.type === 'integer') && value > definition.max) {
      errors.push({ path: definition.path, message: `${definition.label} cannot exceed ${definition.max}${definition.unit && definition.unit !== 'boolean' ? ` ${definition.unit}` : ''}.` })
    }
  }

  validateCrossThresholds(merged, errors)
  return {
    valid: errors.length === 0,
    errors,
    settings: merged,
  }
}

export function getDefaultMetadataMap() {
  const now = null
  return Object.fromEntries(
    listDerivedSettingDefinitions().map((definition) => [
      definition.path,
      {
        lastChangedBy: null,
        lastChangedAt: now,
      },
    ]),
  )
}

export function getLegacySiteSettings(settings = DEFAULT_DERIVED_TRIGGER_SETTINGS) {
  const merged = mergeDerivedTriggerSettings(settings)
  return {
    wellTargetPct: merged.wellFlow.allWellsMeetingFlowTolerancePct,
    recycleOpenPct: merged.recyclePressure.recycleActiveThresholdPct,
    recycleAlertThreshold: merged.recyclePressure.recycleValveAllowedPositionPct,
    meetingFlowPersistSeconds: merged.compressorDispatch.compressorDispatchPersistenceSeconds,
  }
}
