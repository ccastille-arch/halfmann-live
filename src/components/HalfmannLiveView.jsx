import { useState, useEffect, useCallback } from 'react'
import { findRegisterDatapoint, parseLiveDatapoints } from '../engine/liveRegisters'

const API_BASE = import.meta.env.VITE_API_URL || ''
const REFRESH_INTERVAL_S = 60

const HALFMANN_DEVICES = {
  panel:    '2507-501508',
  unit2130: '2507-500709',
  unit2127: '2504-504108',
  unit2129: '2504-504102',
  unit2128: '2507-500076',
}

// unit2129 is the C4 EICS 1396 standby unit (RPM-controlled, no flow PID)
// units 2130/2127/2128 are ASC C5 units (flow PID controlled)
const HALFMANN_UNITS = [
  { key: 'unit2130', label: 'Unit 2130', deviceId: HALFMANN_DEVICES.unit2130, type: 'asc' },
  { key: 'unit2127', label: 'Unit 2127', deviceId: HALFMANN_DEVICES.unit2127, type: 'asc' },
  { key: 'unit2129', label: 'Unit 2129 (Standby)', deviceId: HALFMANN_DEVICES.unit2129, type: 'c4' },
  { key: 'unit2128', label: 'Unit 2128', deviceId: HALFMANN_DEVICES.unit2128, type: 'asc' },
]

// ─── Well panel lookup keys ────────────────────────────────────────────────────
const WELL_FLOW_KEYS = [
  ['Well 1 Injection Gas Flow Rate', 'Well #1 Flow Rate'],
  ['Well 2 Injection Gas Flow Rate', 'Well #2 Flow Rate'],
  ['Well 3 Injection Gas Flow Rate', 'Well #3 Flow Rate'],
  ['Well 4 Injection Gas Flow Rate', 'Well #4 Flow Rate'],
  ['Well 5 Injection Gas Flow Rate', 'Well # 5 Flow Rate', 'Well #5 Flow Rate'],
]
const WELL_SETPOINT_KEYS = [
  ['Well 1 Setpoint', 'Wellhead #1 Injection Flow Rate From Customer PLC', 'Well 1 Setpoint From Customer PLC'],
  ['Well 2 Setpoint', 'Wellhead #2 Injection Flow Rate From Customer PLC', 'Well 2 Setpoint From Customer PLC'],
  ['Well 3 Setpoint', 'Wellhead #3 Injection Flow Rate From Customer PLC', 'Well 3 Setpoint From Customer PLC'],
  ['Well 4 Setpoint', 'Wellhead #4 Injection Flow Rate From Customer PLC', 'Well 4 Setpoint From Customer PLC'],
  ['Well 5 Setpoint', 'Wellhead #5 Injection Flow Rate From Customer PLC', 'Well 5 Setpoint From Customer PLC'],
]
const WELL_YESTERDAY_KEYS = [
  ['Well 1 Yesterdays Flow', 'Wellhead #1 Yesterdays Total Flow', 'Well 1 Yesterdays Total Flow'],
  ['Well 2 Yesterdays Flow', 'Wellhead #2 Yesterdays Total Flow', 'Well 2 Yesterdays Total Flow'],
  ['Well 3 Yesterdays Flow', 'Wellhead #3 Yesterdays Total Flow', 'Well 3 Yesterdays Total Flow'],
  ['Well 4 Yesterdays Flow', 'Wellhead #4 Yesterdays Total Flow', 'Well 4 Yesterdays Total Flow'],
  ['Well 5 Yesterdays Flow', 'Wellhead #5 Yesterdays Total Flow', 'Well 5 Yesterdays Total Flow'],
]
const WELL_CHOKE_KEYS   = [1,2,3,4,5].map(n => [`Well ${n} Choke Position`])
const WELL_CASING_KEYS  = [1,2,3,4,5].map(n => [`Well ${n} Casing Pressure`, `Well #${n} Casing Pressure`])
const WELL_TUBING_KEYS  = [1,2,3,4,5].map(n => [`Well ${n} Tubing Pressure`, `Well #${n} Tubing Pressure`])

// ─── ASC C5 unit param groups (JGA4-KTA19 EICS-12856 config) ──────────────────
// Source: JGA4-KTA19_EICS-12856_v334a_C5_ASC_ServiceCompression_Rev_V2_test_dec.json
// Groups: SC Dynamic 1, SC Dynamic 2, AG1, AG2
const ASC_GROUPS = [
  {
    title: 'Performance',
    params: [
      { label: 'Actual Flow Rate',       keys: ['Flow Rate PID PV', 'Flow Rate'],                                            unit: 'MMSCFD',    dec: 3 },
      { label: 'Flow Setpoint',          keys: ['Flow Rate PID Auto Sp', 'Desire Flow SP For PID Murphy', 'Desired Flow SP For PID Murphy'], unit: 'MMSCFD', dec: 3 },
      { label: 'Speed Output',           keys: ['Speed Output'],                                                              unit: 'RPM',       dec: 0 },
      { label: 'Recycle Valve Output',   keys: ['Recycle Valve Output'],                                                      unit: '% Closed',  dec: 2 },
      { label: 'Suction Control Valve',  keys: ['Suction Control Valve Out'],                                                 unit: '% Closed',  dec: 2 },
      { label: 'Gas Cooler Motor Speed', keys: ['Gas Cooler Motor Speed Out'],                                                unit: 'RPM',       dec: 0 },
    ],
  },
  {
    title: 'Stage Pressures',
    params: [
      { label: 'Stg 1 Suction Prs',    keys: ['Stage 1 Suction Prs', 'Suction Pressure'],                          unit: 'psi', dec: 1 },
      { label: 'Stg 1 Discharge Prs',  keys: ['Stage 1 Discharge Prs'],                                            unit: 'psi', dec: 0 },
      { label: 'Stg 2 Suction Prs',    keys: ['Stage 2 Suction Prs'],                                              unit: 'psi', dec: 0 },
      { label: 'Stg 2 Discharge Prs',  keys: ['Stage 2 Discharge Prs'],                                            unit: 'psi', dec: 0 },
      { label: 'Stg 3 Suction Prs',    keys: ['Stage 3 Suction Prs'],                                              unit: 'psi', dec: 0 },
      { label: 'Stg 3 Discharge Prs',  keys: ['Stage 3 Discharge Prs', 'Discharge Pressure'],                      unit: 'psi', dec: 0 },
      { label: 'Field Pressure',        keys: ['Field Pressure'],                                                   unit: 'psi', dec: 1 },
      { label: 'Fuel Gas Pressure',     keys: ['Fuel Gas Pressure'],                                                unit: 'psi', dec: 1 },
      { label: 'Dump Supply Pressure',  keys: ['Dump Supply Pressure'],                                             unit: 'psi', dec: 1 },
    ],
  },
  {
    title: 'Stage Temperatures',
    params: [
      { label: '1st Stg Suction Temp',    keys: ['1st Stage Suction Temperature'],                                       unit: '°F', dec: 1 },
      { label: '1st Stg Discharge Temp',  keys: ['1st Stage Discharge Temperature', 'Stage 1 Discharge Temperature', 'Discharge Temperature'], unit: '°F', dec: 1 },
      { label: '2nd Stg Suction Temp',    keys: ['2nd Stage Suction Temperature'],                                       unit: '°F', dec: 1 },
      { label: '2nd Stg Discharge Temp',  keys: ['2nd Stage Discharge Temperature', 'Stage 2 Discharge Temperature'],   unit: '°F', dec: 1 },
      { label: '3rd Stg Suction Temp',    keys: ['3rd Stage Suction Temperature'],                                       unit: '°F', dec: 1 },
      { label: '3rd Stg Discharge Temp',  keys: ['3rd Stage Discharge Temperature'],                                     unit: '°F', dec: 1 },
      { label: 'Cooler Outlet Temp',      keys: ['Cooler Outlet Temperature'],                                           unit: '°F', dec: 1 },
    ],
  },
  {
    title: 'Engine & Lube',
    params: [
      { label: 'Engine Speed',        keys: ['Engine Speed From EICS', 'RPM'],                     unit: 'RPM', dec: 0 },
      { label: 'Engine Load',         keys: ['Engine Load'],                                        unit: '%',   dec: 1 },
      { label: 'Engine Oil Temp',     keys: ['Engine Oil Temperature'],                             unit: '°F',  dec: 1 },
      { label: 'Aux Water Temp',      keys: ['Auxiliary Water Temperature', 'EICS Oil Temperature'], unit: '°F', dec: 1 },
      { label: 'Comp Oil Pressure',   keys: ['Compressor Oil Pressure'],                            unit: 'psi', dec: 1 },
      { label: 'Comp Oil Temp',       keys: ['Compressor Oil Temperature'],                         unit: '°F',  dec: 1 },
      { label: 'Comp Oil Filter ΔP',  keys: ['Comp Oil Filter Diff Pressure'],                      unit: 'psi', dec: 1 },
      { label: 'System Volts',        keys: ['System Volts', 'System Voltage'],                     unit: 'VDC', dec: 1 },
    ],
  },
  {
    title: 'GEMS — Compressor Analytics',
    params: [
      { label: 'Compressor Speed',        keys: ['Compressor Speed'],                unit: 'rpm', dec: 0 },
      { label: 'Compressor Hour Meter',   keys: ['Compressor Hour Meter', '\t Hour Meter', 'Hour Meter'], unit: 'hrs', dec: 1 },
      { label: 'Throw 1 CE Suct Prs',     keys: ['Throw 1 Crank-end Cylinder Suction Pressure', 'Throw 1 Suction Pressure'],    unit: 'psig', dec: 2 },
      { label: 'Throw 1 CE Disc Prs',     keys: ['Throw 1 Crank-End Cylinder Discharge Pressure', 'Throw 1 Discharge Pressure'], unit: 'psig', dec: 2 },
      { label: 'Throw 1 CE Suct Temp',    keys: ['Throw 1 Crank-End Cylinder Suction Temperature'],    unit: '°F', dec: 1 },
      { label: 'Throw 1 CE Disc Temp',    keys: ['Throw 1 Crank-end Cylinder Discharge Temperature'],  unit: '°F', dec: 1 },
      { label: 'Throw 2 CE Suct Prs',     keys: ['Throw 2 Crank-end Cylinder Suction Pressure', 'Throw 2 Suction Pressure'],    unit: 'psig', dec: 2 },
      { label: 'Throw 2 CE Disc Prs',     keys: ['Throw 2 Crank-End Cylinder Discharge Pressure', 'Throw 2 Discharge Pressure'], unit: 'psig', dec: 2 },
      { label: 'Throw 2 CE Suct Temp',    keys: ['Throw 2 Crank-End Cylinder Suction Temperature'],    unit: '°F', dec: 1 },
      { label: 'Throw 2 CE Disc Temp',    keys: ['Throw 2 Crank-end Cylinder Discharge Temperature'],  unit: '°F', dec: 1 },
      { label: 'Throw 3 CE Suct Prs',     keys: ['Measured Throw 3 Crank-End Cylinder Suction Pressure', 'Throw 3 Suction Pressure'], unit: 'psig', dec: 2 },
      { label: 'Throw 3 CE Disc Prs',     keys: ['Measured Throw 3 Crank-End Cylinder Discharge Pressure', 'Throw 3 Discharge Pressure'], unit: 'psig', dec: 2 },
      { label: 'Throw 3 CE Suct Temp',    keys: ['Measured Throw 3 Crank-End Cylinder Suction Temperature'],    unit: '°F', dec: 1 },
      { label: 'Throw 3 CE Disc Temp',    keys: ['Measured Throw 3 Crank-End Cylinder Discharge Temperature'],  unit: '°F', dec: 1 },
      { label: 'Throw 4 CE Suct Prs',     keys: ['Measured Throw 4 Crank-End Cylinder Suction Pressure', 'Throw 4 Suction Pressure'], unit: 'psig', dec: 2 },
      { label: 'Throw 4 CE Disc Prs',     keys: ['Measured Throw 4 Crank-End Cylinder Discharge Pressure', 'Throw 4 Discharge Pressure'], unit: 'psig', dec: 2 },
      { label: 'Throw 4 CE Suct Temp',    keys: ['Measured Throw 4 Crank-End Cylinder Suction Temperature'],    unit: '°F', dec: 1 },
      { label: 'Throw 4 CE Disc Temp',    keys: ['Measured Throw 4 Crank-End Cylinder Discharge Temperature'],  unit: '°F', dec: 1 },
    ],
  },
  {
    title: 'GEMS — Valve Cap Temperatures',
    params: [
      { label: '1CS1 Valve Cap', keys: ['Throw 1 Crank-End Suction Valve Cap Temperature 1 [1CS1]'],    unit: '°F', dec: 1 },
      { label: '1CS2 Valve Cap', keys: ['Throw 1 Crank-End Suction Valve Cap Temperature 2 [1CS2]'],    unit: '°F', dec: 1 },
      { label: '1CD1 Valve Cap', keys: ['Throw 1 Crank-End Discharge Valve Cap Temperature 1 [1CD1]'],  unit: '°F', dec: 1 },
      { label: '1CD2 Valve Cap', keys: ['Throw 1 Crank-End Discharge Valve Cap Temperature 2 [1CD2]'],  unit: '°F', dec: 1 },
      { label: '1HS1 Valve Cap', keys: ['Throw 1 Head-End Suction Valve Cap Temperature 1 [1HS1]'],     unit: '°F', dec: 1 },
      { label: '1HS2 Valve Cap', keys: ['Throw 1 Head-End Suction Valve Cap Temperature 2 [1HS2]'],     unit: '°F', dec: 1 },
      { label: '1HD1 Valve Cap', keys: ['Throw 1 Head-End Discharge Valve Cap Temperature 1 [1HD1]'],   unit: '°F', dec: 1 },
      { label: '1HD2 Valve Cap', keys: ['Throw 1 Head-End Discharge Valve Cap Temperature 2 [1HD2]'],   unit: '°F', dec: 1 },
      { label: '2CS1 Valve Cap', keys: ['Throw 2 Crank-End Suction Valve Cap Temperature 1 [2CS1]'],    unit: '°F', dec: 1 },
      { label: '2CD1 Valve Cap', keys: ['Throw 2 Crank-End Discharge Valve Cap Temperature 1 [2CD1]'],  unit: '°F', dec: 1 },
      { label: '2HS1 Valve Cap', keys: ['Throw 2 Head-End Suction Valve Cap Temperature 1 [2HS1]'],     unit: '°F', dec: 1 },
      { label: '2HD1 Valve Cap', keys: ['Throw 2 Head-End Discharge Valve Cap Temperature 1 [2HD1]'],   unit: '°F', dec: 1 },
      { label: '3CS1 Valve Cap', keys: ['Measured Throw 3 Crank-End Suction Valve Cap Temperature 1 [3CS1]'],  unit: '°F', dec: 1 },
      { label: '3CS2 Valve Cap', keys: ['Measured Throw 3 Crank-End Suction Valve Cap Temperature 2 [3CS2]'],  unit: '°F', dec: 1 },
      { label: '3CD1 Valve Cap', keys: ['Measured Throw 3 Crank-End Discharge Valve Cap Temperature 1 [3CD1]'], unit: '°F', dec: 1 },
      { label: '3CD2 Valve Cap', keys: ['Measured Throw 3 Crank-End Discharge Valve Cap Temperature 2 [3CD2]'], unit: '°F', dec: 1 },
      { label: '3HS1 Valve Cap', keys: ['Measured Throw 3 Head-End Suction Valve Cap Temperature 1 [3HS1]'],   unit: '°F', dec: 1 },
      { label: '3HS2 Valve Cap', keys: ['Measured Throw 3 Head-End Suction Valve Cap Temperature 2 [3HS2]'],   unit: '°F', dec: 1 },
      { label: '3HD1 Valve Cap', keys: ['Measured Throw 3 Head-End Discharge Valve Cap Temperature 1 [3HD1]'], unit: '°F', dec: 1 },
      { label: '3HD2 Valve Cap', keys: ['Measured Throw 3 Head-End Discharge Valve Cap Temperature 2 [3HD2]'], unit: '°F', dec: 1 },
      { label: '4CS1 Valve Cap', keys: ['Measured Throw 4 Crank-End Suction Valve Cap Temperature 1 [4CS1]'],  unit: '°F', dec: 1 },
      { label: '4CD1 Valve Cap', keys: ['Measured Throw 4 Crank-End Discharge Valve Cap Temperature 1 [4CD1]'], unit: '°F', dec: 1 },
      { label: '4HS1 Valve Cap', keys: ['Measured Throw 4 Head-End Suction Valve Cap Temperature 1 [4HS1]'],   unit: '°F', dec: 1 },
      { label: '4HD1 Valve Cap', keys: ['Measured Throw 4 Head-End Discharge Valve Cap Temperature 1 [4HD1]'], unit: '°F', dec: 1 },
    ],
  },
  {
    title: 'GEMS — Calculated Stage Performance',
    params: [
      { label: 'Calc Stg1 Suct Prs',   keys: ['Calculated Stage 1 Suction Pressure', 'Measured Stage 1 Suction Pressure'],    unit: 'psig', dec: 1 },
      { label: 'Calc Stg1 Disc Prs',   keys: ['Calculated Stage 1 Discharge Pressure', 'Measured Stage 1 Discharge Pressure'], unit: 'psig', dec: 1 },
      { label: 'Calc Stg1 Suct Temp',  keys: ['Calculated Stage 1 Suction Temperature', 'Measured Stage 1 Suction Temperature'], unit: '°F', dec: 1 },
      { label: 'Calc Stg1 Disc Temp',  keys: ['Calculated Stage 1 Discharge Temperature', 'Measured Stage 1 Discharge Temperature'], unit: '°F', dec: 1 },
      { label: 'Calc Stg2 Suct Prs',   keys: ['Calculated Stage 2 Suction Pressure', 'Measured Stage 2 Suction Pressure'],    unit: 'psig', dec: 1 },
      { label: 'Calc Stg2 Disc Prs',   keys: ['Calculated Stage 2 Discharge Pressure', 'Measured Stage 2 Discharge Pressure'], unit: 'psig', dec: 1 },
      { label: 'Calc Stg2 Suct Temp',  keys: ['Calculated Stage 2 Suction Temperature', 'Measured Stage 2 Suction Temperature'], unit: '°F', dec: 1 },
      { label: 'Calc Stg2 Disc Temp',  keys: ['Calculated Stage 2 Discharge Temperature', 'Measured Stage 2 Discharge Temperature'], unit: '°F', dec: 1 },
      { label: 'Calc Stg3 Suct Prs',   keys: ['Calculated Stage 3 Suction Pressure', 'Measured Stage 3 Suction Pressure'],    unit: 'psig', dec: 1 },
      { label: 'Calc Stg3 Disc Prs',   keys: ['Calculated Stage 3 Discharge Pressure', 'Measured Stage 3 Discharge Pressure'], unit: 'psig', dec: 1 },
      { label: 'Calc Stg3 Suct Temp',  keys: ['Calculated Stage 3 Suction Temperature', 'Measured Stage 3 Suction Temperature'], unit: '°F', dec: 1 },
      { label: 'Calc Stg3 Disc Temp',  keys: ['Calculated Stage 3 Discharge Temperature', 'Measured Stage 3 Discharge Temperature'], unit: '°F', dec: 1 },
      { label: 'Total Mass Flow',       keys: ['Total Compressor Mass Flow'],              unit: 'lbm/s', dec: 2 },
      { label: 'Total Cylinder HP',     keys: ['Measured Total Cylinder Horsepower'],      unit: 'HP',    dec: 0 },
      { label: 'Total Gas HP',          keys: ['Measured Total Gas Horsepower'],           unit: 'HP',    dec: 0 },
      { label: 'Friction HP',           keys: ['Total Compressor Friction Horsepower'],    unit: 'HP',    dec: 0 },
      { label: 'Brake HP',              keys: ['Total Compressor Brake Horsepower'],       unit: 'HP',    dec: 0 },
    ],
  },
  {
    title: 'GEMS — Rod Load & Vibration',
    params: [
      { label: 'Throw 1 Rod Load — Comp',     keys: ['Measured Throw 1 Rod Load - Compression'],             unit: '%', dec: 1 },
      { label: 'Throw 1 Rod Load — Tens',     keys: ['Measured Throw 1 Rod Load - Tension'],                  unit: '%', dec: 1 },
      { label: 'Throw 1 Rod Load — Total',    keys: ['Measured Throw 1 Rod Load - Total'],                    unit: '%', dec: 1 },
      { label: 'Throw 1 Pin Reversal',        keys: ['Measured Throw 1 Crosshead Pin Reversal - Percent Magnitude'], unit: '%', dec: 1 },
      { label: 'Throw 2 Rod Load — Comp',     keys: ['Measured Throw 2 Rod Load - Compression'],             unit: '%', dec: 1 },
      { label: 'Throw 2 Rod Load — Tens',     keys: ['Measured Throw 2 Rod Load - Tension'],                  unit: '%', dec: 1 },
      { label: 'Throw 2 Rod Load — Total',    keys: ['Measured Throw 2 Rod Load - Total'],                    unit: '%', dec: 1 },
      { label: 'Throw 2 Pin Reversal',        keys: ['Measured Throw 2 Crosshead Pin Reversal - Percent Magnitude'], unit: '%', dec: 1 },
      { label: 'Throw 3 Rod Load — Comp',     keys: ['Measured Throw 3 Rod Load - Compression'],             unit: '%', dec: 1 },
      { label: 'Throw 3 Rod Load — Tens',     keys: ['Measured Throw 3 Rod Load - Tension'],                  unit: '%', dec: 1 },
      { label: 'Throw 3 Rod Load — Total',    keys: ['Measured Throw 3 Rod Load - Total'],                    unit: '%', dec: 1 },
      { label: 'Throw 3 Pin Reversal',        keys: ['Measured Throw 3 Crosshead Pin Reversal - Percent Magnitude'], unit: '%', dec: 1 },
      { label: 'Throw 4 Rod Load — Comp',     keys: ['Measured Throw 4 Rod Load - Compression'],             unit: '%', dec: 1 },
      { label: 'Throw 4 Rod Load — Tens',     keys: ['Measured Throw 4 Rod Load - Tension'],                  unit: '%', dec: 1 },
      { label: 'Throw 4 Rod Load — Total',    keys: ['Measured Throw 4 Rod Load - Total'],                    unit: '%', dec: 1 },
      { label: 'Throw 4 Pin Reversal',        keys: ['Measured Throw 4 Crosshead Pin Reversal - Percent Magnitude'], unit: '%', dec: 1 },
      { label: 'Frame Vibration Peak',        keys: ['Measured Frame Velometer (IEPE) Derived Peak'],         unit: 'in/s', dec: 2 },
      { label: 'Torsional Vibration Peak',    keys: ['Torsional Vibration Derived Peak'],                     unit: 'rpm',  dec: 1 },
    ],
  },
  {
    title: 'GEMS — Valve Leak Indices',
    params: [
      { label: 'Valve Leak 1CS1', keys: ['Valve Leak Index: Throw 1 Crank-End Suction Valve 1 [1CS1]'],    unit: '', dec: 2 },
      { label: 'Valve Leak 1CS2', keys: ['Valve Leak Index: Throw 1 Crank-End Suction Valve 2 [1CS2]'],    unit: '', dec: 2 },
      { label: 'Valve Leak 1CD1', keys: ['Valve Leak Index: Throw 1 Crank-End Discharge Valve 1 [1CD1]'],  unit: '', dec: 2 },
      { label: 'Valve Leak 1CD2', keys: ['Valve Leak Index: Throw 1 Crank-End Discharge Valve 2 [1CD2]'],  unit: '', dec: 2 },
      { label: 'Valve Leak 1HS1', keys: ['Valve Leak Index: Throw 1 Head-End Suction Valve 1 [1HS1]'],     unit: '', dec: 2 },
      { label: 'Valve Leak 1HS2', keys: ['Valve Leak Index: Throw 1 Head-End Suction Valve 2 [1HS2]'],     unit: '', dec: 2 },
      { label: 'Valve Leak 1HD1', keys: ['Valve Leak Index: Throw 1 Head-End Discharge Valve 1 [1HD1]'],   unit: '', dec: 2 },
      { label: 'Valve Leak 1HD2', keys: ['Valve Leak Index: Throw 1 Head-End Discharge Valve 2 [1HD2]'],   unit: '', dec: 2 },
      { label: 'Valve Leak 2CS1', keys: ['Valve Leak Index: Throw 2 Crank-End Suction Valve 1 [2CS1]'],    unit: '', dec: 2 },
      { label: 'Valve Leak 2CD1', keys: ['Valve Leak Index: Throw 2 Crank-End Discharge Valve 1 [2CD1]'],  unit: '', dec: 2 },
      { label: 'Valve Leak 2HS1', keys: ['Valve Leak Index: Throw 2 Head-End Suction Valve 1 [2HS1]'],     unit: '', dec: 2 },
      { label: 'Valve Leak 2HD1', keys: ['Valve Leak Index: Throw 2 Head-End Discharge Valve 1 [2HD1]'],   unit: '', dec: 2 },
      { label: 'Valve Leak 3CS1', keys: ['Valve Leak Index: Throw 3 Crank-End Suction Valve 1 [3CS1]'],    unit: '', dec: 2 },
      { label: 'Valve Leak 3CS2', keys: ['Valve Leak Index: Throw 3 Crank-End Suction Valve 2 [3CS2]'],    unit: '', dec: 2 },
      { label: 'Valve Leak 3CD1', keys: ['Valve Leak Index: Throw 3 Crank-End Discharge Valve 1 [3CD1]'],  unit: '', dec: 2 },
      { label: 'Valve Leak 3CD2', keys: ['Valve Leak Index: Throw 3 Crank-End Discharge Valve 2 [3CD2]'],  unit: '', dec: 2 },
      { label: 'Valve Leak 3HS1', keys: ['Valve Leak Index: Throw 3 Head-End Suction Valve 1 [3HS1]'],     unit: '', dec: 2 },
      { label: 'Valve Leak 3HS2', keys: ['Valve Leak Index: Throw 3 Head-End Suction Valve 2 [3HS2]'],     unit: '', dec: 2 },
      { label: 'Valve Leak 3HD1', keys: ['Valve Leak Index: Throw 3 Head-End Discharge Valve 1 [3HD1]'],   unit: '', dec: 2 },
      { label: 'Valve Leak 3HD2', keys: ['Valve Leak Index: Throw 3 Head-End Discharge Valve 2 [3HD2]'],   unit: '', dec: 2 },
      { label: 'Valve Leak 4CS1', keys: ['Valve Leak Index: Throw 4 Crank-End Suction Valve 1 [4CS1]'],    unit: '', dec: 2 },
      { label: 'Valve Leak 4CD1', keys: ['Valve Leak Index: Throw 4 Crank-End Discharge Valve 1 [4CD1]'],  unit: '', dec: 2 },
      { label: 'Valve Leak 4HS1', keys: ['Valve Leak Index: Throw 4 Head-End Suction Valve 1 [4HS1]'],     unit: '', dec: 2 },
      { label: 'Valve Leak 4HD1', keys: ['Valve Leak Index: Throw 4 Head-End Discharge Valve 1 [4HD1]'],   unit: '', dec: 2 },
    ],
  },
  {
    title: 'Dump Monitoring & Service',
    params: [
      { label: 'Stage 2 Dump Rate',    keys: ['Stage 2 Dump Rate'],  unit: 'Dumps/Hr', dec: 0 },
      { label: 'Stage 3 Dump Rate',    keys: ['Stage 3 Dump Rate'],  unit: 'Dumps/Hr', dec: 0 },
      { label: 'Service Remaining 1',  keys: ['Service Rem 1'],      unit: 'hrs', dec: 0 },
      { label: 'Service Remaining 2',  keys: ['Service Rem 2'],      unit: 'hrs', dec: 0 },
      { label: 'Service Remaining 3',  keys: ['Service Rem 3'],      unit: 'hrs', dec: 0 },
      { label: 'Service Remaining 4',  keys: ['Service Rem 4'],      unit: 'hrs', dec: 0 },
      { label: 'Service Remaining 5',  keys: ['Service Rem 5'],      unit: 'hrs', dec: 0 },
      { label: 'Start Attempts/Hr',    keys: ['Number of Start Attempts per Hour'], unit: '', dec: 0 },
    ],
  },
  {
    title: 'PID Outputs',
    params: [
      { label: 'Suction Prs PID Out',    keys: ['Suction Prs PID Out'],              unit: '%', dec: 2 },
      { label: 'Discharge Prs PID Out',  keys: ['Discharge Prs PID Out'],            unit: '%', dec: 2 },
      { label: 'Flow Rate PID Out',      keys: ['Flow Rate PID Out'],                unit: '%', dec: 2 },
      { label: 'Rcy Vlv Suct PID Out',   keys: ['Rcy Vlv - Suct Prs PID Pid Out'],  unit: '%', dec: 2 },
      { label: 'Rcy Vlv Disc PID Out',   keys: ['Rcy Vlv - Dsch Prs PID Out'],      unit: '%', dec: 2 },
      { label: 'Cooler Outlet PID PV',   keys: ['Cooler Outlet Temp PID PV'],        unit: '°F', dec: 1 },
      { label: 'Stg2 Suct Temp PID PV',  keys: ['Stg2 Suction Temp PID PV'],        unit: '°F', dec: 1 },
    ],
  },
]

// ─── C4 EICS unit param groups (IoT_Cfg_File_v334a_C4_EICS_1396 config) ────────
// Source: IoT_Cfg_File_v334a_C4_EICS_1396_command_dev_2_v2.json
const C4_GROUPS = [
  {
    title: 'Engine Control (EICS)',
    params: [
      { label: 'Engine Speed',           keys: ['ENGINE RPM', 'Engine Speed', 'Driver Speed'],               unit: 'RPM',       dec: 0 },
      { label: 'Target Speed',           keys: ['Target Speed'],                                              unit: 'rpm',       dec: 0 },
      { label: 'Engine Load',            keys: ['Engine Load'],                                               unit: '%',         dec: 1 },
      { label: 'Engine Oil Pressure',    keys: ['Engine Oil Presssure', 'Engine Oil Pressure'],               unit: 'psig',      dec: 1 },
      { label: 'Engine Oil Temp',        keys: ['ENGINE OIL T', 'Oil Temperature'],                          unit: '°F',        dec: 0 },
      { label: 'Jacket Water Temp',      keys: ['Jacket Water Temperature'],                                  unit: '°F',        dec: 1 },
      { label: 'Manifold Air Pressure',  keys: ['Manifold Air Pressure'],                                     unit: 'psia',      dec: 2 },
      { label: 'Manifold Air Temp',      keys: ['Manifold Air Temperature'],                                  unit: '°F',        dec: 1 },
      { label: 'Intake Air Temp',        keys: ['Intake Air Temperature'],                                    unit: '°F',        dec: 1 },
      { label: 'Battery Voltage',        keys: ['Battery Voltage', 'System Voltage'],                        unit: 'V',         dec: 1 },
      { label: 'Throttle Position',      keys: ['Throttle Position'],                                         unit: '%',         dec: 1 },
      { label: 'Hour Meter',             keys: ['\t Hour Meter', 'Hour Meter'],                              unit: 'hrs',       dec: 2 },
    ],
  },
  {
    title: 'Fuel & Combustion (EICS)',
    params: [
      { label: 'A/F Ratio',             keys: ['A/F ratio'],                 unit: '',          dec: 2 },
      { label: 'Pre-Catalyst Target',    keys: ['Pre-Catalyst Target'],       unit: '',          dec: 3 },
      { label: 'Pre-Catalyst Phi',       keys: ['Pre-Cataylst Phi'],          unit: 'phi',       dec: 3 },
      { label: 'Post-Catalyst Phi',      keys: ['Post-Catalyst Phi'],         unit: 'phi',       dec: 3 },
      { label: 'Closed Loop',            keys: ['Closed Loop'],               unit: '%',         dec: 1 },
      { label: 'Adaptive',               keys: ['Adaptive'],                  unit: '%',         dec: 1 },
      { label: 'Fuel Temp',              keys: ['Fuel Temperature', 'MFG fuel temperature'], unit: '°F', dec: 1 },
      { label: 'Engine Air Flow',        keys: ['Engine Air Flow'],           unit: 'scfm',      dec: 1 },
      { label: 'Engine Fuel Flow',       keys: ['Engine Fuel Flow'],          unit: 'scfm',      dec: 3 },
      { label: 'Barometric Pressure',    keys: ['Barometric Pressure'],       unit: 'psia',      dec: 2 },
    ],
  },
  {
    title: 'Ignition (EICS)',
    params: [
      { label: 'Total Spark Advance',    keys: ['Total Spark Advance'],    unit: 'CAD BTDC', dec: 1 },
      { label: 'Base Spark Advance',     keys: ['Base Spark Advance'],     unit: 'CAD BTDC', dec: 1 },
      { label: 'Spark Timing',           keys: ['Spark Timing'],           unit: 'CAD BTDC', dec: 1 },
      { label: 'Average Spark',          keys: ['Average Spark'],          unit: 'KV',       dec: 1 },
      { label: 'Average Knock',          keys: ['Average Knock'],          unit: '%',        dec: 1 },
      { label: 'Knock Retard',           keys: ['Knock Retard'],           unit: 'CAD',      dec: 1 },
      { label: 'Cylinder Spark 1-1',     keys: ['Cylinder Spark(1-1)'],    unit: 'KV',       dec: 1 },
      { label: 'Cylinder Spark 2-1',     keys: ['Cylinder Spark(2-1)'],    unit: 'KV',       dec: 1 },
      { label: 'Cylinder Spark 3-1',     keys: ['Cylinder Spark(3-1)'],    unit: 'KV',       dec: 1 },
      { label: 'Cylinder Spark 4-1',     keys: ['Cylinder Spark(4-1)'],    unit: 'KV',       dec: 1 },
      { label: 'Cylinder Spark 5-1',     keys: ['Cylinder Spark(5-1)'],    unit: 'KV',       dec: 1 },
      { label: 'Cylinder Spark 6-1',     keys: ['Cylinder Spark(6-1)'],    unit: 'KV',       dec: 1 },
      { label: 'Cylinder Spark 7-1',     keys: ['Cylinder Spark(7-1)'],    unit: 'KV',       dec: 1 },
      { label: 'Cylinder Spark 8-1',     keys: ['Cylinder Spark(8-1)'],    unit: 'KV',       dec: 1 },
    ],
  },
  {
    title: 'Catalyst',
    params: [
      { label: 'Pre-Catalyst Temp',      keys: ['PRECATALST T', 'Pre-Catalyst Temperature'],   unit: '°F',   dec: 0 },
      { label: 'Post-Catalyst Temp',     keys: ['PSTCATALST T', 'Post-Catalyst Temperature'],  unit: '°F',   dec: 0 },
      { label: 'Catalyst Diff Pressure', keys: ['Catalyst Differential Pressure'],             unit: 'in H2O', dec: 2 },
    ],
  },
  {
    title: 'Compressor (C4)',
    params: [
      { label: 'Suction Pressure',      keys: ['SUCTION PRS', 'Suction Pressure'],           unit: 'PSI', dec: 1 },
      { label: 'Suction Header Prs',    keys: ['SUCT HEAD P'],                               unit: 'PSI', dec: 1 },
      { label: 'Interstage 1 Prs',      keys: ['INTSTG1 PRS'],                               unit: 'PSI', dec: 0 },
      { label: 'Interstage 2 Prs',      keys: ['INTSTG2 PRS'],                               unit: 'PSI', dec: 0 },
      { label: 'Discharge Pressure',    keys: ['DISCHARGE P', 'Discharge Pressure'],         unit: 'PSI', dec: 0 },
      { label: 'Discharge Header Prs',  keys: ['DISC HEAD P'],                               unit: 'PSI', dec: 0 },
      { label: 'Comp Oil Pressure',     keys: ['COMP OIL PRS', 'Compressor Oil Pressure'],   unit: 'PSI', dec: 1 },
    ],
  },
  {
    title: 'Temperatures (C4)',
    params: [
      { label: 'Suction Temp',          keys: ['SUCTION T'],                                                      unit: '°F', dec: 0 },
      { label: 'Discharge Stg 1 Temp',  keys: ['DISCHARG 1 T', 'Stage 1 Discharge Temperature'],                 unit: '°F', dec: 0 },
      { label: 'Discharge Stg 2 Temp',  keys: ['DISCHARG 2 T', 'Stage 2 Discharge Temperature'],                 unit: '°F', dec: 0 },
      { label: 'Discharge Stg 3 Temp',  keys: ['DISCHARG 3 T', 'Discharge Temperature'],                         unit: '°F', dec: 0 },
      { label: 'Comp Oil Temp',         keys: ['COMPRS OIL T', 'Compressor Oil Temperature', 'EICS Oil Temperature'], unit: '°F', dec: 0 },
      { label: 'Engine Oil Temp',       keys: ['ENGINE OIL T', 'Engine Oil Temperature'],                         unit: '°F', dec: 0 },
      { label: 'Oil Temperature',       keys: ['Oil Temperature'],                                                unit: '°F', dec: 2 },
    ],
  },
  {
    title: 'C4 Setpoints & Limits',
    params: [
      { label: 'Lo Suction Prs',       keys: ['LO SUCTION P'],   unit: 'PSI', dec: 1 },
      { label: 'Hi Suction Prs',       keys: ['HI SUCTION P'],   unit: 'PSI', dec: 1 },
      { label: 'Lo Interstage 1 Prs',  keys: ['LO 1 INSTG P'],   unit: 'PSI', dec: 0 },
      { label: 'Hi Interstage 1 Prs',  keys: ['HI 1 INSTG P'],   unit: 'PSI', dec: 0 },
      { label: 'Lo Interstage 2 Prs',  keys: ['LO 2 INSTG P'],   unit: 'PSI', dec: 0 },
      { label: 'Hi Interstage 2 Prs',  keys: ['HI 2 INSTG P'],   unit: 'PSI', dec: 0 },
      { label: 'Lo Discharge Prs',     keys: ['LO DISC P'],       unit: 'PSI', dec: 0 },
      { label: 'Hi Discharge Prs',     keys: ['HI DISC P'],       unit: 'PSI', dec: 0 },
      { label: 'Lo Comp Oil Prs',      keys: ['LO COMP OIL P'],   unit: 'PSI', dec: 1 },
      { label: 'Blowdown Required',    keys: ['BWDN REQ'],         unit: 'PSI', dec: 0 },
      { label: 'Suct Header Start P',  keys: ['SUCT H START P'],  unit: 'PSI', dec: 1 },
      { label: 'Suct Header Stop P',   keys: ['SUCT H STOP P'],   unit: 'PSI', dec: 1 },
      { label: 'Suction Prs Target',   keys: ['Suction Pressure Target'], unit: 'psig', dec: 1 },
    ],
  },
  {
    title: 'C4 Status',
    params: [
      { label: 'Skid State',            keys: ['Skid State', 'Skid - Status'],         unit: '', dec: 0 },
      { label: 'Shutdown Active',        keys: ['Skid - Shutdown', 'C4 Active Fault Shutdown'], unit: '', dec: 0 },
      { label: 'Last Stop Code',         keys: ['Skid - Last Stop Code'],               unit: '', dec: 0 },
      { label: 'C4 Shutdown 01',         keys: ['C4 Shutdown 01'],                      unit: '', dec: 0 },
      { label: 'C4 Shutdown 02',         keys: ['C4 Shutdown 02'],                      unit: '', dec: 0 },
      { label: 'C4 Shutdown 03',         keys: ['C4 Shutdown 03'],                      unit: '', dec: 0 },
      { label: 'C4 Shutdown 04',         keys: ['C4 Shutdown 04'],                      unit: '', dec: 0 },
      { label: 'C4 Shutdown 05',         keys: ['C4 Shutdown 05'],                      unit: '', dec: 0 },
      { label: 'System Voltage',         keys: ['System Voltage'],                       unit: 'V', dec: 0 },
    ],
  },
]

// ─── Settings ─────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = { wellTargetPct: 5, recycleOpenPct: 5 }
const SETTINGS_SCHEMA = {
  wellTargetPct: { label: 'Well On-Target Threshold', description: 'A well is "on target" when actual flow is within this % of its setpoint.', unit: '%', min: 1, max: 25 },
  recycleOpenPct: { label: 'Recycle Valve Open Threshold', description: 'Recycle valve considered "open" above this position %.', unit: '%', min: 0, max: 25 },
}

// ─── Fetch helpers ─────────────────────────────────────────────────────────────
async function fetchDeviceFull(deviceId) {
  try {
    const r = await fetch(`${API_BASE}/api/mlink/device/full?deviceId=${encodeURIComponent(deviceId)}`)
    if (!r.ok) {
      const r2 = await fetch(`${API_BASE}/api/mlink/device?deviceId=${encodeURIComponent(deviceId)}`)
      return r2.ok ? { data: await r2.json(), error: '' } : { data: null, error: `${deviceId}: ${r2.status}` }
    }
    return { data: await r.json(), error: '' }
  } catch (err) { return { data: null, error: err.message } }
}

// ─── Numeric helpers ──────────────────────────────────────────────────────────
function parseLiveNumeric(v) { const n = Number(v); return Number.isFinite(n) ? n : null }
function resolveDP(dataMap, labels) {
  for (const label of labels) {
    const dp = findRegisterDatapoint(dataMap, { label, decimals: 3 })
    if (dp) return dp
  }
  return null
}
function getN(dataMap, labels) { return parseLiveNumeric(resolveDP(dataMap, labels)?.value) }
function getTimestamp(data) { return data?.timestamps?.[0] ? new Date(data.timestamps[0] * 1000) : null }
function fmt(v, d = 3) { return v != null && Number.isFinite(v) ? v.toFixed(d) : '—' }
function getGrade(s) { if (s == null) return '—'; if (s >= 95) return 'A'; if (s >= 85) return 'B'; if (s >= 75) return 'C'; return 'D' }
function gradeStatus(g) { return g === 'A' ? 'good' : g === 'B' ? 'warn' : g === '—' ? 'unknown' : 'bad' }

// ─── UI Components ─────────────────────────────────────────────────────────────
const SC = {
  good:    { border: '#1d6c3d', bg: '#06120a', text: '#22c55e' },
  warn:    { border: '#8a6421', bg: '#120e04', text: '#f8c767' },
  bad:     { border: '#7a1a1a', bg: '#130404', text: '#ef4444' },
  unknown: { border: '#1a1a2a', bg: '#0a0a12', text: '#555' },
}

function GearIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
}

function Gauge({ label, value, unit, status = 'unknown', sub, isAdmin, settingKey, onSettings }) {
  const c = SC[status] || SC.unknown
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: '12px 12px 10px', position: 'relative', display: 'flex', flexDirection: 'column', gap: 3, minHeight: 90 }}>
      {isAdmin && settingKey && (
        <button onClick={() => onSettings(settingKey)} style={{ position: 'absolute', top: 7, right: 7, background: '#1a1a2a', border: '1px solid #2a2a3a', borderRadius: 4, color: '#555', cursor: 'pointer', padding: '2px 3px', lineHeight: 0 }}><GearIcon /></button>
      )}
      <div style={{ fontSize: 8, color: '#666', textTransform: 'uppercase', letterSpacing: '0.11em', fontWeight: 700, paddingRight: isAdmin && settingKey ? 20 : 0, lineHeight: 1.4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: c.text, lineHeight: 1, fontFamily: "'Arial Black',sans-serif", marginTop: 3 }}>{value ?? '—'}</div>
      {unit && <div style={{ fontSize: 8, color: '#555' }}>{unit}</div>}
      {sub && <div style={{ fontSize: 8, color: '#555', marginTop: 1, lineHeight: 1.3 }}>{sub}</div>}
    </div>
  )
}

function YesNoGauge({ label, good, detail, isAdmin, settingKey, onSettings }) {
  const s = good === null || good === undefined ? 'unknown' : good ? 'good' : 'bad'
  const c = SC[s]
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: '12px 12px 10px', position: 'relative', display: 'flex', flexDirection: 'column', gap: 3, minHeight: 90 }}>
      {isAdmin && settingKey && (
        <button onClick={() => onSettings(settingKey)} style={{ position: 'absolute', top: 7, right: 7, background: '#1a1a2a', border: '1px solid #2a2a3a', borderRadius: 4, color: '#555', cursor: 'pointer', padding: '2px 3px', lineHeight: 0 }}><GearIcon /></button>
      )}
      <div style={{ fontSize: 8, color: '#666', textTransform: 'uppercase', letterSpacing: '0.11em', fontWeight: 700, paddingRight: isAdmin && settingKey ? 20 : 0, lineHeight: 1.4 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 900, color: c.text, lineHeight: 1, fontFamily: "'Arial Black',sans-serif", marginTop: 3 }}>{s === 'unknown' ? '—' : good ? 'YES' : 'NO'}</div>
      {detail && <div style={{ fontSize: 8, color: '#555', marginTop: 1, lineHeight: 1.4 }}>{detail}</div>}
    </div>
  )
}

function ScoreGauge({ label, score, detail, isAdmin, settingKey, onSettings }) {
  const g = getGrade(score)
  const s = score == null ? 'unknown' : gradeStatus(g)
  const c = SC[s]
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: '12px 12px 10px', position: 'relative', display: 'flex', flexDirection: 'column', gap: 3, minHeight: 90 }}>
      {isAdmin && settingKey && (
        <button onClick={() => onSettings(settingKey)} style={{ position: 'absolute', top: 7, right: 7, background: '#1a1a2a', border: '1px solid #2a2a3a', borderRadius: 4, color: '#555', cursor: 'pointer', padding: '2px 3px', lineHeight: 0 }}><GearIcon /></button>
      )}
      <div style={{ fontSize: 8, color: '#666', textTransform: 'uppercase', letterSpacing: '0.11em', fontWeight: 700, paddingRight: isAdmin && settingKey ? 20 : 0, lineHeight: 1.4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 3 }}>
        <div style={{ fontSize: 26, fontWeight: 900, color: c.text, lineHeight: 1, fontFamily: "'Arial Black',sans-serif" }}>{score != null ? `${score.toFixed(0)}%` : '—'}</div>
        <div style={{ fontSize: 16, fontWeight: 900, color: c.text, opacity: 0.7, fontFamily: "'Arial Black',sans-serif" }}>{g}</div>
      </div>
      {score != null && <div style={{ height: 3, background: '#111', borderRadius: 2, marginTop: 5, overflow: 'hidden' }}><div style={{ width: `${Math.max(0, Math.min(100, score))}%`, height: '100%', background: c.text, borderRadius: 2 }} /></div>}
      {detail && <div style={{ fontSize: 8, color: '#555', marginTop: 2 }}>{detail}</div>}
    </div>
  )
}

function GaugeGrid({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(155px,1fr))', gap: 8 }}>{children}</div>
}

function Section({ id, title, children }) {
  return (
    <div id={id} style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', color: '#49D0E2', whiteSpace: 'nowrap' }}>{title}</div>
        <div style={{ flex: 1, height: 1, background: '#1a1a2a' }} />
      </div>
      {children}
    </div>
  )
}

function SubSection({ title, children, accent }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: accent || '#555', marginBottom: 7 }}>{title}</div>
      {children}
    </div>
  )
}

function AdminLoginModal({ onClose, onLogin }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      const r = await fetch(`${API_BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) })
      if (r.ok) { const { token } = await r.json(); onLogin(token) }
      else setErr('Invalid password')
    } catch { setErr('Connection error') }
    setBusy(false)
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ background: '#0e0e1a', border: '1px solid #2a2a3a', borderRadius: 14, padding: 28, width: 300 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 18, fontFamily: "'Arial Black'" }}>Admin Login</div>
        <form onSubmit={submit}>
          <input type="password" placeholder="Password" value={pw} onChange={e => setPw(e.target.value)} autoFocus
            style={{ width: '100%', background: '#080810', border: '1px solid #2a2a3a', borderRadius: 7, padding: '9px 11px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          {err && <div style={{ color: '#ef4444', fontSize: 10, marginTop: 7 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, background: '#1a1a2a', border: '1px solid #2a2a3a', borderRadius: 7, color: '#888', padding: 8, cursor: 'pointer', fontSize: 11 }}>Cancel</button>
            <button type="submit" disabled={busy} style={{ flex: 1, background: '#1d4ed8', border: 'none', borderRadius: 7, color: '#fff', padding: 8, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>{busy ? '…' : 'Login'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function GaugeSettingsModal({ settingKey, settings, onSave, onClose }) {
  const schema = SETTINGS_SCHEMA[settingKey]
  const [val, setVal] = useState(settings[settingKey] ?? DEFAULT_SETTINGS[settingKey] ?? '')
  const [busy, setBusy] = useState(false)
  if (!schema) return null
  async function save() { setBusy(true); await onSave(settingKey, Number(val)); setBusy(false); onClose() }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ background: '#0e0e1a', border: '1px solid #2a2a3a', borderRadius: 14, padding: 28, width: 320 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 5, fontFamily: "'Arial Black'" }}>{schema.label}</div>
        <div style={{ fontSize: 10, color: '#666', marginBottom: 18, lineHeight: 1.6 }}>{schema.description}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="number" value={val} min={schema.min} max={schema.max} step="0.5" onChange={e => setVal(e.target.value)}
            style={{ flex: 1, background: '#080810', border: '1px solid #2a2a3a', borderRadius: 7, padding: '9px 11px', color: '#fff', fontSize: 18, fontWeight: 700, outline: 'none', textAlign: 'center' }} />
          <div style={{ color: '#888', fontSize: 12 }}>{schema.unit}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, background: '#1a1a2a', border: '1px solid #2a2a3a', borderRadius: 7, color: '#888', padding: 8, cursor: 'pointer', fontSize: 11 }}>Cancel</button>
          <button onClick={save} disabled={busy} style={{ flex: 1, background: '#1d6c3d', border: 'none', borderRadius: 7, color: '#fff', padding: 8, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

function RefreshBtn({ s, loading, onRefresh }) {
  const pct = Math.round((s / REFRESH_INTERVAL_S) * 100)
  return (
    <button onClick={onRefresh} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 7, border: '1px solid #2a2a3a', background: '#111120', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1 }}>
      <svg width="15" height="15" viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
        <circle cx="18" cy="18" r="15" fill="none" stroke="#1a2a1a" strokeWidth="3" />
        <circle cx="18" cy="18" r="15" fill="none" stroke="#22c55e" strokeWidth="3" strokeDasharray={`${2*Math.PI*15}`} strokeDashoffset={`${2*Math.PI*15*(1-pct/100)}`} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s linear' }} />
      </svg>
      <span style={{ fontSize: 9, color: '#888' }}>{loading ? 'Loading…' : `${s}s`}</span>
    </button>
  )
}

// ─── Param-driven gauge row helper ────────────────────────────────────────────
function ParamGauges({ params, dataMap, isAdmin, onSettings }) {
  return (
    <GaugeGrid>
      {params.map(p => {
        const v = getN(dataMap, p.keys)
        return (
          <Gauge key={p.label} label={p.label}
            value={v != null ? fmt(v, p.dec ?? 1) : '—'}
            unit={v != null ? p.unit : ''}
            sub={v == null ? 'Pending MLink' : undefined}
            status="unknown"
            isAdmin={isAdmin} settingKey={p.settingKey} onSettings={onSettings}
          />
        )
      })}
    </GaugeGrid>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function HalfmannLiveView() {
  const [panelData, setPanelData] = useState(null)
  const [unitDataRaw, setUnitDataRaw] = useState({})
  const [loading, setLoading] = useState(true)
  const [liveError, setLiveError] = useState('')
  const [lastRefresh, setLastRefresh] = useState(null)
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_S)
  const [padVisible, setPadVisible] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminToken, setAdminToken] = useState(() => { try { return localStorage.getItem('halfmann_admin_token') } catch { return null } })
  const [showLogin, setShowLogin] = useState(false)
  const [activeSettings, setActiveSettings] = useState(null)
  const [siteSettings, setSiteSettings] = useState(DEFAULT_SETTINGS)

  useEffect(() => {
    fetch(`${API_BASE}/api/settings`).then(r => r.ok ? r.json() : null).then(s => { if (s) setSiteSettings({ ...DEFAULT_SETTINGS, ...s }) }).catch(() => {})
    fetch(`${API_BASE}/api/public/pad-visibility`).then(r => r.ok ? r.json() : null).then(b => { if (b?.halfmann === false) setPadVisible(false) }).catch(() => {})
  }, [])

  useEffect(() => { if (adminToken) setIsAdmin(true) }, [adminToken])

  function handleLogin(token) {
    setAdminToken(token)
    try { localStorage.setItem('halfmann_admin_token', token) } catch {}
    setIsAdmin(true); setShowLogin(false)
  }
  async function handleLogout() {
    if (adminToken) fetch(`${API_BASE}/api/admin/logout`, { method: 'POST', headers: { 'x-admin-token': adminToken } }).catch(() => {})
    try { localStorage.removeItem('halfmann_admin_token') } catch {}
    setAdminToken(null); setIsAdmin(false)
  }
  async function handleSaveSettings(key, value) {
    const updated = { ...siteSettings, [key]: value }
    try {
      const r = await fetch(`${API_BASE}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken }, body: JSON.stringify(updated) })
      if (r.ok) setSiteSettings({ ...DEFAULT_SETTINGS, ...await r.json() })
      else if (r.status === 401) { setIsAdmin(false); setAdminToken(null); try { localStorage.removeItem('halfmann_admin_token') } catch {} }
    } catch {}
  }
  const openSettings = key => { if (isAdmin) setActiveSettings(key) }

  const refresh = useCallback(async () => {
    setLoading(true); setLiveError('')
    const [panelResult, ...unitResults] = await Promise.all([
      fetchDeviceFull(HALFMANN_DEVICES.panel),
      ...HALFMANN_UNITS.map(u => fetchDeviceFull(u.deviceId)),
    ])
    setPanelData(panelResult.data)
    const raw = {}; HALFMANN_UNITS.forEach((u, i) => { raw[u.key] = unitResults[i].data }); setUnitDataRaw(raw)
    const allNull = !panelResult.data && unitResults.every(r => !r.data)
    if (allNull) setLiveError('No live MLink data available. Check field comms.')
    setLastRefresh(new Date()); setLoading(false); setCountdown(REFRESH_INTERVAL_S)
  }, [])

  useEffect(() => { refresh(); const i = setInterval(refresh, REFRESH_INTERVAL_S * 1000); return () => clearInterval(i) }, [refresh])
  useEffect(() => { const t = setInterval(() => setCountdown(c => c > 0 ? c - 1 : REFRESH_INTERVAL_S), 1000); return () => clearInterval(t) }, [])

  // ─── Derived data ─────────────────────────────────────────────────────────────
  const panel = parseLiveDatapoints(panelData)
  const panelTime = getTimestamp(panelData)
  const unitMaps = HALFMANN_UNITS.map(u => parseLiveDatapoints(unitDataRaw[u.key]))

  const wellTargetPct = siteSettings.wellTargetPct ?? 5
  const recycleOpenPct = siteSettings.recycleOpenPct ?? 5

  const wellData = WELL_FLOW_KEYS.map((flowKeys, i) => ({
    n: i + 1,
    actual:    parseLiveNumeric(resolveDP(panel, flowKeys)?.value),
    desired:   parseLiveNumeric(resolveDP(panel, WELL_SETPOINT_KEYS[i])?.value),
    choke:     parseLiveNumeric(resolveDP(panel, WELL_CHOKE_KEYS[i])?.value),
    casing:    getN(panel, WELL_CASING_KEYS[i]),
    tubing:    getN(panel, WELL_TUBING_KEYS[i]),
    yesterday: parseLiveNumeric(resolveDP(panel, WELL_YESTERDAY_KEYS[i])?.value),
  }))

  const totalDesiredSite = parseLiveNumeric(resolveDP(panel, ['Total Desired Site Flow'])?.value)
  const sumSetpoints = wellData.reduce((s, w) => s + (w.desired ?? 0), 0)
  const hasSetpoints = wellData.some(w => w.desired != null)
  const totalDesired = hasSetpoints ? sumSetpoints : totalDesiredSite
  const totalActual = wellData.reduce((s, w) => s + (w.actual ?? 0), 0)
  const perWellTarget = !hasSetpoints && totalDesiredSite ? totalDesiredSite / 5 : null

  const activeWells = wellData.filter(w => w.actual != null).length
  const wellsOnTarget = wellData.filter(w => {
    if (w.actual == null) return false
    const t = w.desired ?? perWellTarget
    return t != null && t > 0 && Math.abs(w.actual - t) <= t * (wellTargetPct / 100)
  }).length
  const allOnTarget = activeWells > 0 ? wellsOnTarget === activeWells : null

  const casingList = wellData.map((w, i) => w.casing != null ? { v: w.casing, n: i + 1 } : null).filter(Boolean)
  const tubingList = wellData.map((w, i) => w.tubing != null ? { v: w.tubing, n: i + 1 } : null).filter(Boolean)
  const highCasing = casingList.length ? casingList.reduce((a, b) => b.v > a.v ? b : a) : null
  const highTubing = tubingList.length ? tubingList.reduce((a, b) => b.v > a.v ? b : a) : null

  const suctionHeaderPres = getN(panel, ['Suction Header Pressure'])
  const suctionValvePos   = getN(panel, ['Suction/Sales Valve Position'])
  const recycleVal        = getN(panel, ['Recycle Valve Position', 'Recycle Valve', 'RCV Position'])
  const recycleOpen       = recycleVal != null ? recycleVal > recycleOpenPct : null

  const dischargeSP = unitMaps.reduce((f, dm) => f ?? getN(dm, ['Speed Auto Discharge SP', 'Altronic Discharge SP', 'Discharge Pressure SP', 'Speed Control SP']), null)
  const padMatchPct = totalDesired != null && totalDesired > 0 ? Math.max(0, 100 - (Math.abs(totalActual - totalDesired) / totalDesired) * 100) : null

  const unitFlows    = unitMaps.map(dm => getN(dm, ['Flow Rate PID PV', 'Flow Rate']))
  const unitDesired  = HALFMANN_UNITS.map((u, i) =>
    getN(panel, [`Compressor #${i+1} Desire Flow SP For PID Murphy`, `Compressor ${i+1} Desire Flow SP For PID Murphy`]) ??
    getN(unitMaps[i], ['Flow Rate PID Auto Sp', 'Desire Flow SP For PID Murphy', 'Desired Flow SP For PID Murphy', 'Flow Rate PID SP'])
  )

  const wellScores = wellData.map(w => {
    const t = w.desired ?? perWellTarget
    return w.actual != null && t != null && t > 0 ? Math.min(100, (w.actual / t) * 100) : null
  }).filter(v => v != null)
  const wellScore = wellScores.length ? wellScores.reduce((a, b) => a + b, 0) / wellScores.length : null

  const unitScores = unitFlows.map((f, i) => f != null && unitDesired[i] != null && unitDesired[i] > 0 ? Math.min(100, (f / unitDesired[i]) * 100) : null).filter(v => v != null)
  const compressorScore = unitScores.length ? unitScores.reduce((a, b) => a + b, 0) / unitScores.length : null
  const recycleScore = recycleVal != null ? Math.max(0, 100 - recycleVal) : null

  const worstWell = wellData.reduce((w, d) => {
    const t = d.desired ?? perWellTarget
    if (d.actual == null || t == null || t <= 0) return w
    const s = (d.actual / t) * 100
    return w == null || s < w.s ? { n: d.n, s } : w
  }, null)
  const worstUnit = HALFMANN_UNITS.reduce((w, u, i) => {
    if (unitFlows[i] == null || unitDesired[i] == null || unitDesired[i] <= 0) return w
    const s = (unitFlows[i] / unitDesired[i]) * 100
    return w == null || s < w.s ? { label: u.label, s } : w
  }, null)

  if (!padVisible) return <div style={{ display:'flex', minHeight:'100vh', alignItems:'center', justifyContent:'center', background:'#080810' }}><div style={{ color:'#888', fontSize:15 }}>This page is not currently available.</div></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#080810' }}>

      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 18px', background: '#0c0c16', borderBottom: '1px solid #1a1a2a', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 7px #22c55e88' }} />
          <div>
            <div style={{ fontSize: 13, color: '#fff', fontWeight: 700, fontFamily: "'Arial Black'" }}>Live Field Data — Halfmann 1214</div>
            <div style={{ fontSize: 9, color: '#555' }}>{lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : 'Connecting…'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <RefreshBtn s={countdown} loading={loading} onRefresh={refresh} />
          {isAdmin
            ? <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:9, color:'#22c55e', fontWeight:700, letterSpacing:'0.1em' }}>ADMIN</span>
                <button onClick={handleLogout} style={{ background:'#1a1a2a', border:'1px solid #2a2a3a', borderRadius:6, color:'#888', cursor:'pointer', padding:'4px 9px', fontSize:9 }}>Logout</button>
              </div>
            : <button onClick={() => setShowLogin(true)} style={{ background:'#1a1a2a', border:'1px solid #2a2a3a', borderRadius:6, color:'#666', cursor:'pointer', padding:'5px 12px', fontSize:9, fontWeight:700, letterSpacing:'0.1em' }}>ADMIN LOGIN</button>
          }
        </div>
      </header>

      {showLogin && <AdminLoginModal onClose={() => setShowLogin(false)} onLogin={handleLogin} />}
      {activeSettings && <GaugeSettingsModal settingKey={activeSettings} settings={siteSettings} onSave={handleSaveSettings} onClose={() => setActiveSettings(null)} />}

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 18px' }}>
        <div style={{ maxWidth: 1440, margin: '0 auto' }}>
          {liveError && <div style={{ background:'#1f0c0c', border:'1px solid #5a1d1d', borderRadius:7, padding:'9px 14px', marginBottom:18, fontSize:10, color:'#fca5a5' }}>{liveError}</div>}

          {/* ── GROUP 1: SITE SUMMARY ── */}
          <Section id="site-summary" title="Group 1 — Site Summary">
            <GaugeGrid>
              <YesNoGauge label="All Wells Meeting Desired Rate?" good={allOnTarget}
                detail={activeWells > 0 ? `${wellsOnTarget} of ${activeWells} within ${wellTargetPct}%` : 'Awaiting data'}
                isAdmin={isAdmin} settingKey="wellTargetPct" onSettings={openSettings} />
              <Gauge label="Wells Meeting Rate" value={activeWells > 0 ? `${wellsOnTarget} / ${activeWells}` : '—'}
                status={activeWells > 0 ? (wellsOnTarget === activeWells ? 'good' : wellsOnTarget >= activeWells * 0.6 ? 'warn' : 'bad') : 'unknown'}
                isAdmin={isAdmin} settingKey="wellTargetPct" onSettings={openSettings} />
              <Gauge label="Total Desired Flow" value={totalDesired != null ? fmt(totalDesired) : '—'} unit={totalDesired != null ? 'MMSCFD' : ''}
                sub={hasSetpoints ? 'Sum of well setpoints' : totalDesiredSite != null ? 'Panel register' : 'Pending MLink config'} />
              <Gauge label="Total Actual Flow" value={fmt(totalActual)} unit="MMSCFD"
                status={padMatchPct != null ? (padMatchPct >= 95 ? 'good' : padMatchPct >= 80 ? 'warn' : 'bad') : 'unknown'}
                sub={totalDesired != null ? `${fmt(padMatchPct, 1)}% of desired` : undefined} />
              <YesNoGauge label="Recycle Valve Open?" good={recycleOpen === null ? null : !recycleOpen}
                detail={recycleVal == null ? 'Pending MLink config' : `Position: ${recycleVal.toFixed(1)}% (threshold: ${recycleOpenPct}%)`}
                isAdmin={isAdmin} settingKey="recycleOpenPct" onSettings={openSettings} />
              <Gauge label="Highest Casing Pressure" value={highCasing ? fmt(highCasing.v, 0) : '—'} unit={highCasing ? 'PSI' : ''}
                sub={highCasing ? `Well ${highCasing.n}` : 'Pending MLink config'} />
              <Gauge label="Highest Tubing Pressure" value={highTubing ? fmt(highTubing.v, 0) : '—'} unit={highTubing ? 'PSI' : ''}
                sub={highTubing ? `Well ${highTubing.n}` : 'Pending MLink config'} />
              <Gauge label="Altronic Discharge Trigger SP" value={dischargeSP != null ? fmt(dischargeSP, 0) : '—'} unit={dischargeSP != null ? 'PSI' : ''}
                sub={dischargeSP == null ? 'Pending MLink config' : undefined} />
            </GaugeGrid>
          </Section>

          {/* ── GROUP 2: OPTIMIZATION ── */}
          <Section id="optimization" title="Group 2 — Optimization Scorecards">
            <GaugeGrid>
              <ScoreGauge label="Compressor Flow Score" score={compressorScore}
                detail={worstUnit ? `Worst: ${worstUnit.label} (${fmt(worstUnit.s, 0)}%)` : 'Awaiting desired flow data'}
                isAdmin={isAdmin} />
              <ScoreGauge label="Well Injection Score" score={wellScore}
                detail={worstWell ? `Worst: Well ${worstWell.n} (${fmt(worstWell.s, 0)}%)` : 'Awaiting setpoint data'}
                isAdmin={isAdmin} settingKey="wellTargetPct" onSettings={openSettings} />
              <ScoreGauge label="Recycle Efficiency" score={recycleScore}
                detail={recycleVal != null ? `Valve at ${recycleVal.toFixed(1)}%` : 'Pending MLink config'}
                isAdmin={isAdmin} settingKey="recycleOpenPct" onSettings={openSettings} />
              <Gauge label="Worst Performing Unit" value={worstUnit ? worstUnit.label : '—'}
                sub={worstUnit ? `Score: ${fmt(worstUnit.s, 0)}%` : 'Awaiting data'}
                status={worstUnit ? gradeStatus(getGrade(worstUnit.s)) : 'unknown'} />
              <Gauge label="Worst Performing Well" value={worstWell ? `Well ${worstWell.n}` : '—'}
                sub={worstWell ? `Score: ${fmt(worstWell.s, 0)}%` : 'Awaiting data'}
                status={worstWell ? gradeStatus(getGrade(worstWell.s)) : 'unknown'} />
            </GaugeGrid>
          </Section>

          {/* ── GROUP 3: SITE DATA ── */}
          <Section id="site-data" title="Group 3 — Site Data">
            <GaugeGrid>
              <Gauge label="Suction Header Pressure" value={suctionHeaderPres != null ? fmt(suctionHeaderPres, 0) : '—'} unit={suctionHeaderPres != null ? 'PSI' : ''} sub={suctionHeaderPres == null ? 'Pending MLink config' : undefined} />
              <Gauge label="Suction / Sales Valve" value={suctionValvePos != null ? fmt(suctionValvePos, 1) : '—'} unit={suctionValvePos != null ? '%' : ''} sub={suctionValvePos == null ? 'Pending MLink config' : undefined} />
              <Gauge label="Recycle Valve Position" value={recycleVal != null ? `${recycleVal.toFixed(1)}` : '—'} unit={recycleVal != null ? '%' : ''}
                sub={recycleVal == null ? 'Pending MLink config' : recycleVal > recycleOpenPct ? 'OPEN' : 'Closed'}
                status={recycleVal == null ? 'unknown' : recycleVal > recycleOpenPct ? 'bad' : 'good'}
                isAdmin={isAdmin} settingKey="recycleOpenPct" onSettings={openSettings} />
            </GaugeGrid>
          </Section>

          {/* ── GROUP 4: WELL DATA ── */}
          <Section id="wells" title="Group 4 — Well Data">
            {wellData.map(w => (
              <SubSection key={w.n} title={`Well ${w.n}`} accent="#49D0E2">
                <GaugeGrid>
                  <Gauge label={`Well ${w.n} Setpoint`} value={w.desired != null ? fmt(w.desired) : '—'} unit={w.desired != null ? 'MMSCFD' : ''} sub={w.desired == null ? 'Pending MLink config' : undefined} />
                  <Gauge label={`Well ${w.n} Injection Flow`} value={w.actual != null ? fmt(w.actual) : '—'} unit={w.actual != null ? 'MMSCFD' : ''}
                    status={(() => { const t = w.desired ?? perWellTarget; if (w.actual == null || !t) return 'unknown'; const d = Math.abs(w.actual - t) / t * 100; return d <= wellTargetPct ? 'good' : d <= wellTargetPct * 2 ? 'warn' : 'bad' })()} />
                  <Gauge label={`Well ${w.n} Choke Position`} value={w.choke != null ? fmt(w.choke, 1) : '—'} unit={w.choke != null ? '%' : ''} sub={w.choke == null ? 'Pending MLink config' : undefined} />
                  <Gauge label={`Well ${w.n} Casing Pressure`} value={w.casing != null ? fmt(w.casing, 0) : '—'} unit={w.casing != null ? 'PSI' : ''} sub={w.casing == null ? 'Pending MLink config' : undefined} />
                  <Gauge label={`Well ${w.n} Tubing Pressure`} value={w.tubing != null ? fmt(w.tubing, 0) : '—'} unit={w.tubing != null ? 'PSI' : ''} sub={w.tubing == null ? 'Pending MLink config' : undefined} />
                </GaugeGrid>
              </SubSection>
            ))}
          </Section>

          {/* ── GROUP 5: YESTERDAYS FLOW ── */}
          <Section id="yesterday" title="Group 5 — Yesterdays Flow Volumes">
            <GaugeGrid>
              {wellData.map(w => (
                <Gauge key={w.n} label={`Well ${w.n} Yesterdays Flow`}
                  value={w.yesterday != null ? fmt(w.yesterday) : '—'} unit={w.yesterday != null ? 'MMSCFD' : ''}
                  sub={w.yesterday == null ? 'Pending MLink config' : undefined} />
              ))}
            </GaugeGrid>
          </Section>

          {/* ── GROUP 6: COMPRESSOR UNITS ── */}
          <Section id="compressors" title="Group 6 — Compressor Units">
            {HALFMANN_UNITS.map((u, i) => {
              const dm = unitMaps[i]
              const groups = u.type === 'asc' ? ASC_GROUPS : C4_GROUPS
              const rpm = getN(dm, ['Engine Speed From EICS', 'RPM', 'Driver Speed', 'ENGINE RPM', 'Engine Speed', 'Compressor Speed'])
              const isRunning = rpm != null && rpm > 100
              const hasData = unitDataRaw[u.key] != null
              return (
                <div key={u.key} style={{ marginBottom: 28 }}>
                  {/* Unit header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '10px 14px', background: '#0c0c18', border: '1px solid #1a1a2a', borderRadius: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: isRunning ? '#22c55e' : hasData ? '#ef4444' : '#333', boxShadow: isRunning ? '0 0 8px #22c55e88' : 'none', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: "'Arial Black'" }}>{u.label}</div>
                      <div style={{ fontSize: 9, color: '#555' }}>{u.type === 'asc' ? 'ASC C5 — Flow PID Controlled' : 'C4 EICS — RPM Controlled (Standby)'} · {isRunning ? `RUNNING @ ${Math.round(rpm)} RPM` : hasData ? 'STOPPED' : 'NO DATA'}</div>
                    </div>
                    {unitFlows[i] != null && <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                      <div style={{ fontSize: 20, fontWeight: 900, color: '#22c55e', fontFamily: "'Arial Black'" }}>{fmt(unitFlows[i])} MMSCFD</div>
                      <div style={{ fontSize: 8, color: '#555' }}>Actual Flow</div>
                    </div>}
                  </div>
                  {/* Param groups */}
                  {groups.map(g => (
                    <SubSection key={g.title} title={g.title}>
                      <ParamGauges params={g.params} dataMap={dm} isAdmin={isAdmin} onSettings={openSettings} />
                    </SubSection>
                  ))}
                </div>
              )
            })}
          </Section>

          <footer style={{ textAlign: 'center', padding: '18px 0', borderTop: '1px solid #1a1a2a', marginTop: 8 }}>
            <span style={{ fontSize: 8, color: '#333' }}>Halfmann 1214 · Read-only public view · Refreshes every 60 seconds</span>
          </footer>
        </div>
      </div>
    </div>
  )
}
