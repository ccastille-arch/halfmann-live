import { useEffect, useMemo, useState } from 'react'
import HalfmannLiveView from './components/HalfmannLiveView'
import HalfmannTelemetryView from './components/HalfmannTelemetryView'
import HalfmannDiagnosticsView from './components/HalfmannDiagnosticsView'
import HalfmannOptimizationView from './components/HalfmannOptimizationView'
import HalfmannPerformanceReportView from './components/HalfmannPerformanceReportView'
import HalfmannAdminLoginView from './components/HalfmannAdminLoginView'
import HalfmannDerivedTriggerSettingsAdminView from './components/HalfmannDerivedTriggerSettingsAdminView'
import HalfmannAlertRulesAdminView from './components/HalfmannAlertRulesAdminView'
import { HalfmannDataProvider, useHalfmannData } from './context/HalfmannDataContext'
import { PANEL_ADDRESSES, getNumericByAddress } from './engine/halfmannRegisters'

const API_BASE = import.meta.env.VITE_API_URL || ''

function getPage() {
  const path = window.location.pathname.toLowerCase()
  if (path.includes('/admin/alert-rules')) return 'admin-alert-rules'
  if (path.includes('/admin/derived-trigger-settings')) return 'admin-derived-trigger-settings'
  if (path.includes('/admin/login')) return 'admin-login'
  if (path.includes('performance-report') || path.includes('welllogic-performance-report')) return 'performance-report'
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

function UtilityButton({ children, onClick, active = false }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '0 14px',
        height: 34,
        borderRadius: 999,
        border: `1px solid ${active ? 'rgba(73,208,226,0.45)' : '#24324a'}`,
        background: active ? 'rgba(73,208,226,0.12)' : '#0b1220',
        color: active ? '#7dd3fc' : '#bfdbfe',
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}

function AppShell() {
  const [page, setPage] = useState(getPage)
  const [adminAuthenticated, setAdminAuthenticated] = useState(false)
  const { panelData, meetingState, liveError, commsStatus } = useHalfmannData()

  useEffect(() => {
    const handler = () => setPage(getPage())
    window.addEventListener('hashchange', handler)
    window.addEventListener('popstate', handler)
    return () => {
      window.removeEventListener('hashchange', handler)
      window.removeEventListener('popstate', handler)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/admin/session`, { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled) setAdminAuthenticated(Boolean(body?.authenticated))
      })
      .catch(() => {
        if (!cancelled) setAdminAuthenticated(false)
      })
    return () => {
      cancelled = true
    }
  }, [page])

  function goTo(p) {
    if (p === 'performance-report') {
      window.history.pushState({}, '', '/performance-report')
    } else if (p === 'admin-alert-rules') {
      window.history.pushState({}, '', '/admin/alert-rules')
    } else if (p === 'admin-login') {
      window.history.pushState({}, '', '/admin/login')
    } else if (p === 'admin-derived-trigger-settings') {
      window.history.pushState({}, '', '/admin/derived-trigger-settings')
    } else {
      if (window.location.pathname !== '/') window.history.pushState({}, '', '/')
      if (p === 'telemetry') window.location.hash = '#/telemetry'
      else if (p === 'diagnostics') window.location.hash = '#/diagnostics'
      else if (p === 'optimization') window.location.hash = '#/optimization'
      else window.location.hash = '#/'
    }
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

  if (page === 'admin-login') {
    return <HalfmannAdminLoginView />
  }

  if (page === 'admin-derived-trigger-settings') {
    return <HalfmannDerivedTriggerSettingsAdminView />
  }

  if (page === 'admin-alert-rules') {
    return <HalfmannAlertRulesAdminView />
  }

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
        <NavButton active={page === 'performance-report'} alert={false} onClick={() => goTo('performance-report')}>
          Performance Report
        </NavButton>
        <NavButton active={page === 'telemetry'} alert={false} onClick={() => goTo('telemetry')}>
          All Parameters
        </NavButton>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <UtilityButton
            active={page === 'admin-login' || page === 'admin-derived-trigger-settings' || page === 'admin-alert-rules'}
            onClick={() => goTo(adminAuthenticated ? 'admin-derived-trigger-settings' : 'admin-login')}
          >
            {adminAuthenticated ? 'Admin Settings' : 'Admin Login'}
          </UtilityButton>
          {adminAuthenticated ? (
            <UtilityButton
              active={page === 'admin-alert-rules'}
              onClick={() => goTo('admin-alert-rules')}
            >
              Alert Rules
            </UtilityButton>
          ) : null}
          <div style={{ fontSize: 9, color: '#3a3a55', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          Halfmann 1214
          </div>
        </div>
      </nav>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {page === 'live'
          ? <HalfmannLiveView />
          : page === 'telemetry'
            ? <HalfmannTelemetryView />
            : page === 'diagnostics'
              ? <HalfmannDiagnosticsView />
              : page === 'performance-report'
                ? <HalfmannPerformanceReportView />
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
