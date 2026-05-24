import { useEffect, useMemo, useRef, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || ''

function formatTimestamp(value) {
  if (!value) return '--'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '--' : parsed.toLocaleString()
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function getPathValue(root, path) {
  return path.split('.').reduce((current, key) => current?.[key], root)
}

function setPathValue(root, path, value) {
  const parts = path.split('.')
  const last = parts.pop()
  let current = root
  for (const part of parts) {
    if (!current[part] || typeof current[part] !== 'object') current[part] = {}
    current = current[part]
  }
  current[last] = value
}

function flattenSchema(schema = {}) {
  return Object.entries(schema).map(([groupKey, group]) => ({
    groupKey,
    groupLabel: group.label,
    settings: Object.entries(group.settings || {}).map(([settingKey, setting]) => ({
      groupKey,
      groupLabel: group.label,
      settingKey,
      path: `${groupKey}.${settingKey}`,
      ...setting,
    })),
  }))
}

function toneStyles(tone) {
  if (tone === 'green') return { border: '#1f8f55', bg: 'linear-gradient(180deg, rgba(7,34,22,0.96) 0%, rgba(7,19,14,0.96) 100%)', label: '#4ade80', text: '#dcfce7' }
  if (tone === 'yellow') return { border: '#9a7d18', bg: 'linear-gradient(180deg, rgba(35,28,8,0.96) 0%, rgba(20,15,6,0.96) 100%)', label: '#facc15', text: '#fef3c7' }
  if (tone === 'orange') return { border: '#b26a14', bg: 'linear-gradient(180deg, rgba(38,22,8,0.96) 0%, rgba(22,13,6,0.96) 100%)', label: '#fb923c', text: '#fed7aa' }
  if (tone === 'red') return { border: '#952c37', bg: 'linear-gradient(180deg, rgba(37,11,16,0.96) 0%, rgba(20,7,11,0.96) 100%)', label: '#f87171', text: '#fee2e2' }
  return { border: '#29547a', bg: 'linear-gradient(180deg, rgba(10,21,34,0.96) 0%, rgba(8,14,24,0.96) 100%)', label: '#7dd3fc', text: '#dbeafe' }
}

function AdminButton({ children, onClick, tone = 'blue', disabled = false, type = 'button' }) {
  const style = toneStyles(tone)
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        borderRadius: 14,
        border: `1px solid ${disabled ? 'rgba(90,103,123,0.35)' : style.border}`,
        background: disabled ? 'rgba(16,22,30,0.9)' : style.bg,
        color: disabled ? '#6b7f98' : style.label,
        fontWeight: 800,
        fontSize: 12,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        padding: '10px 14px',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

export default function HalfmannDerivedTriggerSettingsAdminView() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [payload, setPayload] = useState(null)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [comment, setComment] = useState('')
  const [importError, setImportError] = useState('')
  const fileInputRef = useRef(null)

  const groups = useMemo(() => flattenSchema(payload?.schema || {}), [payload])

  const changedCount = useMemo(() => {
    if (!payload || !draft) return 0
    return groups.reduce((count, group) => count + group.settings.filter((setting) => {
      const currentValue = getPathValue(payload.derivedTriggerSettings, setting.path)
      const draftValue = getPathValue(draft, setting.path)
      return !Object.is(currentValue, draftValue)
    }).length, 0)
  }, [draft, groups, payload])

  async function loadAdminPayload() {
    setLoading(true)
    setError('')
    try {
      const sessionResponse = await fetch(`${API_BASE}/api/admin/session`, { credentials: 'include' })
      const sessionBody = await sessionResponse.json().catch(() => ({}))
      if (!sessionBody.authenticated) {
        window.history.replaceState({}, '', '/admin/login')
        window.dispatchEvent(new PopStateEvent('popstate'))
        return
      }
      const response = await fetch(`${API_BASE}/api/admin/derived-trigger-settings`, { credentials: 'include' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error || 'Failed to load derived trigger settings')
        return
      }
      setPayload(body)
      setDraft(deepClone(body.derivedTriggerSettings))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAdminPayload()
  }, [])

  function updateSetting(path, nextValue, type) {
    setDraft((current) => {
      const next = deepClone(current)
      let parsed = nextValue
      if (type === 'boolean') parsed = Boolean(nextValue)
      if (type === 'integer') parsed = nextValue === '' ? '' : Math.round(Number(nextValue))
      if (type === 'number') parsed = nextValue === '' ? '' : Number(nextValue)
      setPathValue(next, path, parsed)
      return next
    })
  }

  async function saveChanges() {
    if (!draft) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/api/admin/derived-trigger-settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          derivedTriggerSettings: draft,
          comment,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        const details = Array.isArray(body.details) ? body.details.map((item) => item.message).join(' ') : ''
        setError([body.error, details].filter(Boolean).join(' ') || 'Failed to save settings')
        return
      }
      setPayload(body)
      setDraft(deepClone(body.derivedTriggerSettings))
      setComment('')
      window.dispatchEvent(new CustomEvent('derived-trigger-settings-updated', {
        detail: {
          ...body.legacySettings,
          derivedTriggerSettings: body.derivedTriggerSettings,
          fetchedAt: body.fetchedAt,
        },
      }))
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function resetGroup(groupKey) {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/api/admin/derived-trigger-settings/reset-group`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupKey, comment }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error || 'Failed to reset group')
        return
      }
      setPayload(body)
      setDraft(deepClone(body.derivedTriggerSettings))
      setComment('')
      window.dispatchEvent(new CustomEvent('derived-trigger-settings-updated', {
        detail: {
          ...body.legacySettings,
          derivedTriggerSettings: body.derivedTriggerSettings,
          fetchedAt: body.fetchedAt,
        },
      }))
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function resetSetting(path) {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/api/admin/derived-trigger-settings/reset-setting`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, comment }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error || 'Failed to reset setting')
        return
      }
      setPayload(body)
      setDraft(deepClone(body.derivedTriggerSettings))
      setComment('')
      window.dispatchEvent(new CustomEvent('derived-trigger-settings-updated', {
        detail: {
          ...body.legacySettings,
          derivedTriggerSettings: body.derivedTriggerSettings,
          fetchedAt: body.fetchedAt,
        },
      }))
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function exportJson() {
    const response = await fetch(`${API_BASE}/api/admin/derived-trigger-settings/export`, { credentials: 'include' })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setError(body.error || 'Failed to export config')
      return
    }
    const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `derived-trigger-settings-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function handleImportFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setImportError('')
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const response = await fetch(`${API_BASE}/api/admin/derived-trigger-settings/import`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...parsed,
          comment,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        const details = Array.isArray(body.details) ? body.details.map((item) => item.message).join(' ') : ''
        setImportError([body.error, details].filter(Boolean).join(' ') || 'Import failed')
        return
      }
      setPayload(body)
      setDraft(deepClone(body.derivedTriggerSettings))
      setComment('')
      window.dispatchEvent(new CustomEvent('derived-trigger-settings-updated', {
        detail: {
          ...body.legacySettings,
          derivedTriggerSettings: body.derivedTriggerSettings,
          fetchedAt: body.fetchedAt,
        },
      }))
    } catch (err) {
      setImportError(err.message)
    } finally {
      event.target.value = ''
    }
  }

  async function logout() {
    await fetch(`${API_BASE}/api/admin/logout`, { method: 'POST', credentials: 'include' }).catch(() => {})
    window.history.replaceState({}, '', '/admin/login')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  return (
    <div style={{
      height: '100vh',
      background: 'radial-gradient(circle at top left, rgba(73,208,226,0.08), transparent 30%), linear-gradient(180deg, #05050c 0%, #080812 100%)',
      color: '#f4f8ff',
      padding: 24,
      overflowY: 'auto',
    }}>
      <div style={{ maxWidth: 1480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <section style={{
          borderRadius: 24,
          border: '1px solid rgba(73,208,226,0.18)',
          background: 'linear-gradient(180deg, rgba(10,16,27,0.98) 0%, rgba(8,12,20,0.98) 100%)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.28)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 11, color: '#49d0e2', fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 8 }}>
                Admin Only
              </div>
              <h1 style={{ margin: 0, fontSize: 28 }}>Derived Trigger Settings Admin</h1>
              <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.7, color: '#c7d5ea', maxWidth: 980 }}>
                Central configuration for derived status logic, optimization thresholds, runtime KPI scoring, and exported performance reports.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <AdminButton tone="blue" onClick={() => {
                window.history.replaceState({}, '', '/admin/alert-rules')
                window.dispatchEvent(new PopStateEvent('popstate'))
              }}>Alert Rules</AdminButton>
              <AdminButton tone="green" onClick={saveChanges} disabled={saving || loading || !draft || changedCount === 0}>Save Changes</AdminButton>
              <AdminButton tone="blue" onClick={exportJson} disabled={loading}>Export Config JSON</AdminButton>
              <AdminButton tone="yellow" onClick={() => fileInputRef.current?.click()} disabled={loading}>Import Config JSON</AdminButton>
              <AdminButton tone="blue" onClick={() => {
                window.history.replaceState({}, '', '/')
                window.dispatchEvent(new PopStateEvent('popstate'))
              }}>Back To Site</AdminButton>
              <AdminButton tone="orange" onClick={logout}>Logout</AdminButton>
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

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)', gap: 16 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#8ca0be', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Change Reason / Comment</span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={4}
                placeholder="Explain why these thresholds are changing."
                style={{
                  borderRadius: 16,
                  border: '1px solid rgba(138,183,232,0.22)',
                  background: 'rgba(10,15,24,0.94)',
                  color: '#f4f8ff',
                  padding: 14,
                  fontSize: 14,
                  resize: 'vertical',
                }}
              />
            </label>
            <div style={{
              borderRadius: 18,
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(9,15,24,0.92)',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
              <div style={{ fontSize: 12, color: '#8ca0be', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Status</div>
              <div style={{ fontSize: 14, color: '#f4f8ff' }}>Pending changes: <strong>{changedCount}</strong></div>
              <div style={{ fontSize: 14, color: '#f4f8ff' }}>Last changed by: <strong>{payload?.updatedBy || '--'}</strong></div>
              <div style={{ fontSize: 14, color: '#f4f8ff' }}>Last changed at: <strong>{formatTimestamp(payload?.updatedAt)}</strong></div>
              <div style={{ fontSize: 13, color: '#8ca0be' }}>Imported/exported JSON never includes credentials or active sessions.</div>
            </div>
          </div>

          {error ? <div style={{ color: '#fda4af', fontSize: 13 }}>{error}</div> : null}
          {importError ? <div style={{ color: '#fdba74', fontSize: 13 }}>{importError}</div> : null}
          <input ref={fileInputRef} type="file" accept="application/json" hidden onChange={handleImportFile} />
        </section>

        {loading ? (
          <div style={{ color: '#8ca0be', fontSize: 14 }}>Loading derived trigger settings…</div>
        ) : groups.map((group, groupIndex) => (
          <details
            key={group.groupKey}
            open={groupIndex === 0}
            style={{
              borderRadius: 24,
              border: '1px solid rgba(73,208,226,0.14)',
              background: 'linear-gradient(180deg, rgba(8,13,22,0.96) 0%, rgba(6,10,16,0.96) 100%)',
              overflow: 'hidden',
            }}
          >
            <summary style={{
              listStyle: 'none',
              cursor: 'pointer',
              padding: '18px 20px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'linear-gradient(90deg, rgba(73,208,226,0.12) 0%, rgba(73,208,226,0.02) 55%)',
            }}>
              <div>
                <div style={{ fontSize: 11, color: '#49d0e2', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 6 }}>
                  Threshold Group
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#f8fafc' }}>{group.groupLabel}</div>
              </div>
              <AdminButton tone="yellow" onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                resetGroup(group.groupKey)
              }} disabled={saving}>Reset Group To Defaults</AdminButton>
            </summary>

            <div style={{ padding: 20, display: 'grid', gap: 14 }}>
              {group.settings.map((setting) => {
                const currentValue = getPathValue(draft, setting.path)
                const liveValue = getPathValue(payload?.derivedTriggerSettings, setting.path)
                const meta = payload?.metadata?.[setting.path] || {}
                const changed = !Object.is(currentValue, liveValue)
                return (
                  <div key={setting.path} style={{
                    borderRadius: 20,
                    border: `1px solid ${changed ? 'rgba(73,208,226,0.35)' : 'rgba(255,255,255,0.08)'}`,
                    background: changed ? 'rgba(9,24,33,0.92)' : 'rgba(9,15,24,0.92)',
                    padding: 16,
                    display: 'grid',
                    gridTemplateColumns: 'minmax(280px, 1.2fr) minmax(220px, 0.9fr) minmax(180px, 0.8fr)',
                    gap: 16,
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: '#f4f8ff' }}>{setting.label}</div>
                      <div style={{ fontSize: 13, lineHeight: 1.7, color: '#c7d5ea' }}>{setting.description}</div>
                      <div style={{ fontSize: 12, color: '#8ca0be' }}>
                        Path: <code>{setting.path}</code>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ fontSize: 12, color: '#8ca0be', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Current Value</div>
                      {setting.type === 'boolean' ? (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#f4f8ff' }}>
                          <input
                            type="checkbox"
                            checked={Boolean(currentValue)}
                            onChange={(event) => updateSetting(setting.path, event.target.checked, setting.type)}
                          />
                          {currentValue ? 'Enabled' : 'Disabled'}
                        </label>
                      ) : (
                        <input
                          type="number"
                          min={setting.min}
                          max={setting.max}
                          step={setting.step}
                          value={currentValue ?? ''}
                          onChange={(event) => updateSetting(setting.path, event.target.value, setting.type)}
                          style={{
                            minHeight: 44,
                            borderRadius: 14,
                            border: '1px solid rgba(138,183,232,0.22)',
                            background: 'rgba(10,15,24,0.94)',
                            color: '#f4f8ff',
                            padding: '0 14px',
                            fontSize: 14,
                          }}
                        />
                      )}
                      <div style={{ display: 'grid', gap: 6, fontSize: 12, color: '#8ca0be' }}>
                        <div>Default: <strong style={{ color: '#f4f8ff' }}>{String(setting.defaultValue)}</strong></div>
                        <div>Unit: <strong style={{ color: '#f4f8ff' }}>{setting.unit}</strong></div>
                        <div>Range: <strong style={{ color: '#f4f8ff' }}>{setting.min ?? '--'} to {setting.max ?? '--'}</strong></div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ fontSize: 12, color: '#8ca0be', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Audit</div>
                      <div style={{ fontSize: 13, lineHeight: 1.7, color: '#c7d5ea' }}>
                        Last changed by: <strong style={{ color: '#f4f8ff' }}>{meta.lastChangedBy || '--'}</strong><br />
                        Last changed at: <strong style={{ color: '#f4f8ff' }}>{formatTimestamp(meta.lastChangedAt)}</strong>
                      </div>
                      <AdminButton tone="blue" onClick={() => resetSetting(setting.path)} disabled={saving}>Reset To Default</AdminButton>
                    </div>
                  </div>
                )
              })}
            </div>
          </details>
        ))}

        <section style={{
          borderRadius: 24,
          border: '1px solid rgba(73,208,226,0.14)',
          background: 'linear-gradient(180deg, rgba(8,13,22,0.96) 0%, rgba(6,10,16,0.96) 100%)',
          padding: 24,
        }}>
          <div style={{ fontSize: 11, color: '#49d0e2', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 8 }}>
            Audit Log
          </div>
          <h2 style={{ margin: '0 0 16px', fontSize: 24 }}>Change History</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead>
                <tr>
                  {['Timestamp', 'User', 'Action', 'Setting', 'Old Value', 'New Value', 'Reason / Note'].map((label) => (
                    <th key={label} style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color: '#8ca0be',
                      borderBottom: '1px solid rgba(255,255,255,0.08)',
                    }}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(payload?.auditLog || []).map((entry, index) => (
                  <tr key={`${entry.timestamp}-${entry.settingKey || entry.type || index}`}>
                    <td style={{ padding: '14px', fontSize: 13, color: '#dbeafe', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{formatTimestamp(entry.timestamp)}</td>
                    <td style={{ padding: '14px', fontSize: 13, color: '#f4f8ff', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{entry.user || '--'}</td>
                    <td style={{ padding: '14px', fontSize: 13, color: '#dbeafe', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{entry.type || entry.action || '--'}</td>
                    <td style={{ padding: '14px', fontSize: 13, color: '#dbeafe', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{entry.settingKey || '--'}</td>
                    <td style={{ padding: '14px', fontSize: 13, color: '#dbeafe', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{entry.oldValue == null ? '--' : String(entry.oldValue)}</td>
                    <td style={{ padding: '14px', fontSize: 13, color: '#dbeafe', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{entry.newValue == null ? '--' : String(entry.newValue)}</td>
                    <td style={{ padding: '14px', fontSize: 13, color: '#dbeafe', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{entry.reason || entry.note || '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
