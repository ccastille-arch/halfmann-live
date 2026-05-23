export const PANEL_ADDRESSES = {
  totalDesiredSiteFlow: '420003',
  compressorsMeetingFlowDemand: '420018',
  anyCompressorNotMeetingDesiredFlow: '420023',
  recommendedCompressors: '420039',
  unitDesiredFlowSetpoints: ['460002', '460004', '460006', '460008'],
  de4000OverrideLatch: '460018',
  de4000OverrideCompSpeedSp: '460020',
  wellCalculatedDesiredFlow: ['460050', '460064', '460078', '460092', '460106'],
  wellFlow: ['460212', '460226', '460240', '460254', '460268'],
  wellStaticPressure: ['460214', '460228', '460242', '460256', '460270'],
  wellDifferentialPressure: ['460216', '460230', '460244', '460258', '460272'],
  wellSetpoint: ['460220', '460234', '460248', '460262', '460276'],
  wellYesterdayFlow: ['460222', '460236', '460250', '460264', '460278'],
  wellCasingPressure: ['400231', '400235', '400239', '400243', '400247'],
  wellTubingPressure: ['400233', '400237', '400241', '400245', '400249'],
  wellChokePosition: ['400017', '400035', '400053', '400071', '400089'],
  recycleValvePosition: ['400189', '460618'],
}

export const UNIT_ADDRESSES = {
  actualFlow: ['400656'],
  suctionPressure: ['400505'],
  dischargePressure: ['400510'],
  loadedAutoSp: ['401018'],
  engineSpeed: ['0x01000000', '16777216'],
}

export function normalizeRegisterAddress(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function resolveDatapointByAddress(data, addresses) {
  if (!data?.datapoints?.length) return null
  const normalizedAddresses = addresses.map(normalizeRegisterAddress)
  return data.datapoints.find((datapoint) =>
    normalizedAddresses.includes(normalizeRegisterAddress(datapoint.addressStr || datapoint.address)),
  ) ?? null
}

export function getNumericByAddress(data, addresses) {
  const value = resolveDatapointByAddress(data, addresses)?.value
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export function hasAnyAddress(data, addresses) {
  return addresses.some((address) => resolveDatapointByAddress(data, [address]))
}
