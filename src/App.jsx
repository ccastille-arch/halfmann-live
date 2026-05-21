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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#080810' }}>
      <nav style={{
        display: 'flex', alignItems: 'center',
        background: '#05050f', borderBottom: '2px solid #1a1a2a',
        padding: '0 16px', height: 48, flexShrink: 0, gap: 4,
      }}>
        <button
          onClick={() => goTo('live')}
          style={{
            padding: '0 20px', height: 48, fontSize: 11, fontWeight: 800,
            letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer',
            background: 'none', border: 'none', transition: 'color 0.15s',
            color: page === 'live' ? '#49D0E2' : '#8888a8',
            borderBottom: page === 'live' ? '2px solid #49D0E2' : '2px solid transparent',
            marginBottom: -2,
          }}
        >
          Live View
        </button>
        <button
          onClick={() => goTo('telemetry')}
          style={{
            padding: '0 20px', height: 48, fontSize: 11, fontWeight: 800,
            letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer',
            background: 'none', border: 'none', transition: 'color 0.15s',
            color: page === 'telemetry' ? '#49D0E2' : '#8888a8',
            borderBottom: page === 'telemetry' ? '2px solid #49D0E2' : '2px solid transparent',
            marginBottom: -2,
          }}
        >
          All Parameters
        </button>
        <div style={{ marginLeft: 'auto', fontSize: 9, color: '#3a3a55', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          Halfmann 1214
        </div>
      </nav>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {page === 'live' ? <HalfmannLiveView /> : <HalfmannTelemetryView />}
      </div>
    </div>
  )
}
