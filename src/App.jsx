import { useState, useEffect } from 'react'
import HalfmannLiveView from './components/HalfmannLiveView'
import HalfmannTelemetryView from './components/HalfmannTelemetryView'

function getPage() {
  return window.location.hash.includes('telemetry') ? 'telemetry' : 'live'
}

export default function App() {
  const [page, setPage] = useState(getPage)

  useEffect(() => {
    const handler = () => setPage(getPage())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  function goTo(p) {
    window.location.hash = p === 'telemetry' ? '#/telemetry' : '#/'
    setPage(p)
  }

  const btnBase = {
    padding: '0 18px', height: 38, fontSize: 10, fontWeight: 700,
    letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer',
    background: 'none', border: 'none', transition: 'color 0.15s',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#080810' }}>
      <nav style={{
        display: 'flex', alignItems: 'center',
        background: '#05050f', borderBottom: '1px solid #1a1a2a',
        padding: '0 12px', height: 38, flexShrink: 0,
      }}>
        <button onClick={() => goTo('live')} style={{
          ...btnBase,
          color: page === 'live' ? '#49D0E2' : '#444',
          borderBottom: page === 'live' ? '2px solid #49D0E2' : '2px solid transparent',
        }}>Live View</button>
        <button onClick={() => goTo('telemetry')} style={{
          ...btnBase,
          color: page === 'telemetry' ? '#49D0E2' : '#444',
          borderBottom: page === 'telemetry' ? '2px solid #49D0E2' : '2px solid transparent',
        }}>Telemetry Dashboard</button>
      </nav>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {page === 'live' ? <HalfmannLiveView /> : <HalfmannTelemetryView />}
      </div>
    </div>
  )
}
