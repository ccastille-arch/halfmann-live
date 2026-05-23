import { useEffect, useMemo, useState } from 'react'
import HalfmannLiveView from './components/HalfmannLiveView'
import HalfmannTelemetryView from './components/HalfmannTelemetryView'
import HalfmannDiagnosticsView from './components/HalfmannDiagnosticsView'
import HalfmannOptimizationView from './components/HalfmannOptimizationView'
import { HalfmannDataProvider, useHalfmannData } from './context/HalfmannDataContext'
import { PANEL_ADDRESSES, getNumericByAddress } from './engine/halfmannRegisters'

function getPage() {
  if (window.location.hash.includes('optimization')) return 'optimization'
  if (window.location.hash.includes('diagnostics')) return 'diagnostics'
  if (window.location.hash.includes('telemetry')) return 'telemetry'
  return 'live'
}

function parseSignalBoolean(value) {
  if (value == null) return null
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'yes' || normalized === 'yes (1)' || normalized === 'yes (2)' || normalized === '1' || normalized === '2' || normalized === 'true') return true
  if (normalized === 'no' || normalized === 'no (0)' || normalized === '0' || normalized === 'false') return false
  return null
}

function NavButton({ active, alert, children, onClick }) {
  const activeColor = '#49D0E2'
  const idleColor = '#8888a8'
  const alertColor = '#ff4d4d'

  return (
    <button
      onClick={onClick}
      style={{
        padding: '0 20px',
        height: 48,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        background: 'none',
        border: 'none',
        transition: 'color 0.15s, border-color 0.15s, text-shadow 0.15s',
        color: alert ? alertColor : active ? activeColor : idleColor,
        borderBottom: active
          ? `2px solid ${alert ? alertColor : activeColor}`
          : alert
            ? `2px solid ${alertColor}`
            : '2px solid transparent',
        marginBottom: -2,
        animation: alert ? 'diagnostics-alert-pulse 1s ease-in-out infinite' : 'none',
        textShadow: alert ? '0 0 10px rgba(255, 77, 77, 0.5)' : 'none',
      }}
    >
      {children}
    </button>
  )
}

function AppShell() {
  const [page, setPage] = useState(getPage)
  const { panelData, meetingState, liveError, commsStatus } = useHalfmannData()

  useEffect(() => {
    const handler = () => setPage(getPage())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  function goTo(p) {
    if (p === 'telemetry') window.location.hash = '#/telemetry'
    else if (p === 'diagnostics') window.location.hash = '#/diagnostics'
    else if (p === 'optimization') window.location.hash = '#/optimization'
    else window.location.hash = '#/'
    setPage(p)
  }

  const diagnosticsAlert = useMemo(() => {
    const wellShortActive = Object.values(meetingState?.wells ?? {}).some((value) => value === false)
    const compressorShortActive = Object.values(meetingState?.compressors ?? {}).some((value) => value === false)
    const overrideActive = (getNumericByAddress(panelData, [PANEL_ADDRESSES.de4000OverrideLatch]) ?? 0) > 0
    const recycleActive = (getNumericByAddress(panelData, PANEL_ADDRESSES.recycleValvePosition) ?? 0) > 5
    const anyCompressorNotMeeting = parseSignalBoolean(
      panelData?.datapoints?.find((dp) => String(dp.addressStr || dp.address) === String(PANEL_ADDRESSES.anyCompressorNotMeetingDesiredFlow))?.value,
    )
    const feedIssue = Boolean(liveError) || Boolean(commsStatus?.isHolding)
    const compressorFlowDiagnostic = wellShortActive && (compressorShortActive || anyCompressorNotMeeting === true)
    return wellShortActive || compressorFlowDiagnostic || overrideActive || recycleActive || feedIssue
  }, [panelData, meetingState, liveError, commsStatus])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#080810' }}>
      <style>{`
        @keyframes diagnostics-alert-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
      `}</style>
      <nav style={{
        display: 'flex', alignItems: 'center',
        background: '#05050f', borderBottom: '2px solid #1a1a2a',
        padding: '0 16px', height: 48, flexShrink: 0, gap: 4,
      }}>
        <NavButton active={page === 'live'} alert={false} onClick={() => goTo('live')}>
          Live View
        </NavButton>
        <NavButton active={page === 'diagnostics'} alert={diagnosticsAlert} onClick={() => goTo('diagnostics')}>
          Diagnostics
        </NavButton>
        <NavButton active={page === 'optimization'} alert={false} onClick={() => goTo('optimization')}>
          Optimization
        </NavButton>
        <NavButton active={page === 'telemetry'} alert={false} onClick={() => goTo('telemetry')}>
          All Parameters
        </NavButton>
        <div style={{ marginLeft: 'auto', fontSize: 9, color: '#3a3a55', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          Halfmann 1214
        </div>
      </nav>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {page === 'live'
          ? <HalfmannLiveView />
          : page === 'telemetry'
            ? <HalfmannTelemetryView />
            : page === 'diagnostics'
              ? <HalfmannDiagnosticsView />
              : <HalfmannOptimizationView />}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <HalfmannDataProvider>
      <AppShell />
    </HalfmannDataProvider>
  )
}
