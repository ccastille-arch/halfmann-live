import { useEffect, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || ''

export default function HalfmannAdminLoginView() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [configured, setConfigured] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/admin/session`, { credentials: 'include' })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (cancelled) return
        setConfigured(body.authConfigured !== false)
        if (body.authenticated) {
          window.history.replaceState({}, '', '/admin/derived-trigger-settings')
          window.dispatchEvent(new PopStateEvent('popstate'))
          return
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/api/admin/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setConfigured(body.authConfigured !== false)
        setError(body.error || 'Invalid credentials')
        return
      }
      window.history.replaceState({}, '', '/admin/derived-trigger-settings')
      window.dispatchEvent(new PopStateEvent('popstate'))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      minHeight: '100%',
      background: 'radial-gradient(circle at top left, rgba(73,208,226,0.08), transparent 30%), linear-gradient(180deg, #05050c 0%, #080812 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      color: '#f4f8ff',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 520,
        borderRadius: 28,
        border: '1px solid rgba(73,208,226,0.18)',
        background: 'linear-gradient(180deg, rgba(10,16,27,0.98) 0%, rgba(8,12,20,0.98) 100%)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.3)',
        padding: 28,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}>
        <div>
          <div style={{ fontSize: 11, color: '#49d0e2', fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 10 }}>
            Admin Access
          </div>
          <h1 style={{ margin: 0, fontSize: 30 }}>Derived Trigger Settings Admin</h1>
          <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.7, color: '#c7d5ea' }}>
            Admin-only access for derived thresholds, optimization triggers, KPI tolerances, and runtime scoring rules.
          </div>
        </div>

        <div style={{
          borderRadius: 18,
          border: '1px solid rgba(249,115,22,0.35)',
          background: 'rgba(43,22,8,0.92)',
          color: '#fed7aa',
          padding: 16,
          fontSize: 13,
          lineHeight: 1.7,
        }}>
          Changing these values affects derived status, optimization recommendations, KPI scoring, and exported runtime reports. These settings do not directly change field PLC/panel control logic unless separately written to the controller.
        </div>

        {loading ? (
          <div style={{ fontSize: 14, color: '#8ca0be' }}>Checking admin session…</div>
        ) : !configured ? (
          <div style={{
            borderRadius: 18,
            border: '1px solid rgba(239,68,68,0.35)',
            background: 'rgba(39,12,17,0.94)',
            color: '#fecaca',
            padding: 16,
            fontSize: 13,
            lineHeight: 1.7,
          }}>
            Admin authentication is not configured yet. Set `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, and `ADMIN_SESSION_SECRET` in Railway before using this page.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#8ca0be', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Username</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                style={{
                  minHeight: 48,
                  borderRadius: 14,
                  border: '1px solid rgba(138,183,232,0.22)',
                  background: 'rgba(10,15,24,0.94)',
                  color: '#f4f8ff',
                  padding: '0 14px',
                  fontSize: 14,
                }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#8ca0be', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                style={{
                  minHeight: 48,
                  borderRadius: 14,
                  border: '1px solid rgba(138,183,232,0.22)',
                  background: 'rgba(10,15,24,0.94)',
                  color: '#f4f8ff',
                  padding: '0 14px',
                  fontSize: 14,
                }}
              />
            </label>
            {error ? <div style={{ color: '#fda4af', fontSize: 13 }}>{error}</div> : null}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="submit"
                disabled={busy}
                style={{
                  borderRadius: 14,
                  border: '1px solid rgba(31,143,85,0.65)',
                  background: 'linear-gradient(180deg, rgba(7,34,22,0.96) 0%, rgba(7,19,14,0.96) 100%)',
                  color: '#4ade80',
                  fontWeight: 800,
                  fontSize: 12,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  padding: '12px 16px',
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                {busy ? 'Signing In…' : 'Sign In'}
              </button>
              <button
                type="button"
                onClick={() => {
                  window.history.replaceState({}, '', '/')
                  window.dispatchEvent(new PopStateEvent('popstate'))
                }}
                style={{
                  borderRadius: 14,
                  border: '1px solid rgba(73,208,226,0.35)',
                  background: 'rgba(10,15,24,0.94)',
                  color: '#7dd3fc',
                  fontWeight: 800,
                  fontSize: 12,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  padding: '12px 16px',
                  cursor: 'pointer',
                }}
              >
                Back To Site
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
