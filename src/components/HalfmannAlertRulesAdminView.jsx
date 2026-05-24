import { useEffect, useMemo, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || ''

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
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

function FieldLabel({ children }) {
  return (
    <div style={{ fontSize: 11, color: '#8ca0be', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
      {children}
    </div>
  )
}

function Input({ value, onChange, placeholder = '', type = 'text' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      style={{
        minHeight: 42,
        width: '100%',
        borderRadius: 12,
        border: '1px solid rgba(138,183,232,0.22)',
        background: 'rgba(10,15,24,0.94)',
        color: '#f4f8ff',
        padding: '0 12px',
        fontSize: 14,
      }}
    />
  )
}

function TextArea({ value, onChange, placeholder = '', rows = 3 }) {
  return (
    <textarea
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      style={{
        width: '100%',
        borderRadius: 12,
        border: '1px solid rgba(138,183,232,0.22)',
        background: 'rgba(10,15,24,0.94)',
        color: '#f4f8ff',
        padding: 12,
        fontSize: 14,
        resize: 'vertical',
      }}
    />
  )
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={onChange}
      style={{
        minHeight: 42,
        width: '100%',
        borderRadius: 12,
        border: '1px solid rgba(138,183,232,0.22)',
        background: 'rgba(10,15,24,0.94)',
        color: '#f4f8ff',
        padding: '0 12px',
        fontSize: 14,
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function createBrowserRule(defaultRule) {
  const next = deepClone(defaultRule)
  next.id = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return next
}

function createOperand(type = 'siteValue') {
  if (type === 'number') return { type: 'number', value: 0 }
  if (type === 'text') return { type: 'text', value: '' }
  if (type === 'boolean') return { type: 'boolean', value: true }
  if (type === 'customRegister') return { type: 'customRegister', scope: 'panel', deviceId: '2507-501508', address: '' }
  if (type === 'expression') {
    return {
      type: 'expression',
      operator: 'subtract',
      left: createOperand('siteValue'),
      right: createOperand('number'),
    }
  }
  return { type: 'siteValue', key: 'site.dischargeOverrideLatch' }
}

function OperandEditor({
  title,
  operand,
  onChange,
  fieldOptions,
  deviceOptions,
  expressionOperators,
  allowExpression = true,
}) {
  const typeOptions = [
    { value: 'siteValue', label: 'Site Value' },
    { value: 'customRegister', label: 'Custom Register' },
    { value: 'number', label: 'Number' },
    { value: 'text', label: 'Text' },
    { value: 'boolean', label: 'Yes / No' },
    ...(allowExpression ? [{ value: 'expression', label: 'Math Expression' }] : []),
  ]

  return (
    <div style={{
      borderRadius: 16,
      border: '1px solid rgba(73,208,226,0.14)',
      background: 'rgba(10,15,24,0.75)',
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ fontSize: 12, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {title}
      </div>
      <Select
        value={operand?.type || 'siteValue'}
        onChange={(event) => onChange(createOperand(event.target.value))}
        options={typeOptions}
      />

      {operand?.type === 'siteValue' ? (
        <Select
          value={operand.key || 'site.dischargeOverrideLatch'}
          onChange={(event) => onChange({ ...operand, key: event.target.value })}
          options={fieldOptions}
        />
      ) : null}

      {operand?.type === 'customRegister' ? (
        <>
          <Select
            value={operand.scope || 'panel'}
            onChange={(event) => onChange({
              ...operand,
              scope: event.target.value,
              deviceId: event.target.value === 'panel' ? '2507-501508' : (deviceOptions.find((option) => option.deviceId !== '2507-501508')?.deviceId || ''),
            })}
            options={[
              { value: 'panel', label: 'Halfmann Well Panel' },
              { value: 'unit', label: 'Specific Unit Device' },
            ]}
          />
          {operand.scope === 'unit' ? (
            <Select
              value={operand.deviceId || ''}
              onChange={(event) => onChange({ ...operand, deviceId: event.target.value })}
              options={deviceOptions.filter((option) => option.deviceId !== '2507-501508').map((option) => ({
                value: option.deviceId,
                label: option.label,
              }))}
            />
          ) : null}
          <Input
            value={operand.address || ''}
            onChange={(event) => onChange({ ...operand, address: event.target.value })}
            placeholder="Register address, e.g. 460018"
          />
        </>
      ) : null}

      {operand?.type === 'number' ? (
        <Input
          type="number"
          value={operand.value ?? 0}
          onChange={(event) => onChange({ ...operand, value: Number(event.target.value) })}
        />
      ) : null}

      {operand?.type === 'text' ? (
        <Input
          value={operand.value || ''}
          onChange={(event) => onChange({ ...operand, value: event.target.value })}
          placeholder="Text comparison value"
        />
      ) : null}

      {operand?.type === 'boolean' ? (
        <Select
          value={String(Boolean(operand.value))}
          onChange={(event) => onChange({ ...operand, value: event.target.value === 'true' })}
          options={[
            { value: 'true', label: 'Yes / True' },
            { value: 'false', label: 'No / False' },
          ]}
        />
      ) : null}

      {operand?.type === 'expression' ? (
        <>
          <Select
            value={operand.operator || 'subtract'}
            onChange={(event) => onChange({ ...operand, operator: event.target.value })}
            options={expressionOperators}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            <OperandEditor
              title="Expression Left"
              operand={operand.left || createOperand('siteValue')}
              onChange={(nextOperand) => onChange({ ...operand, left: nextOperand })}
              fieldOptions={fieldOptions}
              deviceOptions={deviceOptions}
              expressionOperators={expressionOperators}
              allowExpression={false}
            />
            <OperandEditor
              title="Expression Right"
              operand={operand.right || createOperand('number')}
              onChange={(nextOperand) => onChange({ ...operand, right: nextOperand })}
              fieldOptions={fieldOptions}
              deviceOptions={deviceOptions}
              expressionOperators={expressionOperators}
              allowExpression={false}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}

function RuleCard({
  rule,
  onChange,
  onRemove,
  onSendTest,
  testSending = false,
  fieldOptions,
  deviceOptions,
  comparatorOptions,
  expressionOperators,
}) {
  return (
    <section style={{
      borderRadius: 22,
      border: '1px solid rgba(73,208,226,0.16)',
      background: 'linear-gradient(180deg, rgba(11,17,29,0.98) 0%, rgba(8,12,20,0.98) 100%)',
      padding: 18,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
    }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '1 1 300px' }}>
          <FieldLabel>Alert Name</FieldLabel>
          <Input value={rule.name} onChange={(event) => onChange({ ...rule, name: event.target.value })} />
        </div>
        <div style={{ width: 180 }}>
          <FieldLabel>Severity</FieldLabel>
          <Select
            value={rule.severity}
            onChange={(event) => onChange({ ...rule, severity: event.target.value })}
            options={[
              { value: 'info', label: 'Info' },
              { value: 'warning', label: 'Warning' },
              { value: 'critical', label: 'Critical' },
            ]}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 24, color: '#d8e3f4', fontSize: 14 }}>
          <input
            type="checkbox"
            checked={rule.enabled !== false}
            onChange={(event) => onChange({ ...rule, enabled: event.target.checked })}
          />
          Enabled
        </label>
        <AdminButton tone="yellow" onClick={onSendTest} disabled={testSending || !rule.recipients?.length}>
          {testSending ? 'Sending Test…' : 'Send Test Email'}
        </AdminButton>
        <AdminButton tone="red" onClick={onRemove}>Delete Rule</AdminButton>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <div>
          <FieldLabel>Persistence Seconds</FieldLabel>
          <Input
            type="number"
            value={rule.persistSeconds ?? 0}
            onChange={(event) => onChange({ ...rule, persistSeconds: Number(event.target.value) })}
          />
        </div>
        <div>
          <FieldLabel>Cooldown Minutes</FieldLabel>
          <Input
            type="number"
            value={rule.cooldownMinutes ?? 0}
            onChange={(event) => onChange({ ...rule, cooldownMinutes: Number(event.target.value) })}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 24, color: '#d8e3f4', fontSize: 14 }}>
          <input
            type="checkbox"
            checked={Boolean(rule.sendClear)}
            onChange={(event) => onChange({ ...rule, sendClear: event.target.checked })}
          />
          Send clear email
        </label>
      </div>

      <div>
        <FieldLabel>Recipient Emails</FieldLabel>
        <TextArea
          rows={3}
          value={Array.isArray(rule.recipients) ? rule.recipients.join(', ') : ''}
          onChange={(event) => onChange({
            ...rule,
            recipients: event.target.value
              .split(/[\n,;]/)
              .map((entry) => entry.trim())
              .filter(Boolean),
          })}
          placeholder="person1@company.com, person2@company.com"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) 180px minmax(280px, 1fr)', gap: 14, alignItems: 'start' }}>
        <OperandEditor
          title="Left Side"
          operand={rule.condition?.left || createOperand('siteValue')}
          onChange={(operand) => onChange({ ...rule, condition: { ...rule.condition, left: operand } })}
          fieldOptions={fieldOptions}
          deviceOptions={deviceOptions}
          expressionOperators={expressionOperators}
        />
        <div style={{
          borderRadius: 16,
          border: '1px solid rgba(73,208,226,0.14)',
          background: 'rgba(10,15,24,0.75)',
          padding: 14,
        }}>
          <div style={{ fontSize: 12, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
            Compare
          </div>
          <Select
            value={rule.condition?.comparator || 'eq'}
            onChange={(event) => onChange({ ...rule, condition: { ...rule.condition, comparator: event.target.value } })}
            options={comparatorOptions}
          />
        </div>
        <OperandEditor
          title="Right Side"
          operand={rule.condition?.right || createOperand('boolean')}
          onChange={(operand) => onChange({ ...rule, condition: { ...rule.condition, right: operand } })}
          fieldOptions={fieldOptions}
          deviceOptions={deviceOptions}
          expressionOperators={expressionOperators}
        />
      </div>

      <div>
        <FieldLabel>Optional Alert Note</FieldLabel>
        <TextArea
          rows={2}
          value={rule.messageTemplate || ''}
          onChange={(event) => onChange({ ...rule, messageTemplate: event.target.value })}
          placeholder="Optional note added to the email body."
        />
      </div>
    </section>
  )
}

export default function HalfmannAlertRulesAdminView() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [payload, setPayload] = useState(null)
  const [draftRules, setDraftRules] = useState([])
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [testSendingRuleId, setTestSendingRuleId] = useState('')
  const [testStatus, setTestStatus] = useState({})

  const fieldOptions = useMemo(
    () => (payload?.options?.fieldCatalog || []).map((field) => ({
      value: field.key,
      label: field.unit ? `${field.label} (${field.unit})` : field.label,
    })),
    [payload],
  )

  async function loadPayload() {
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
      const response = await fetch(`${API_BASE}/api/admin/alert-rules`, { credentials: 'include' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error || 'Failed to load alert rules')
        return
      }
      setPayload(body)
      setDraftRules(deepClone(body.rules || []))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPayload()
  }, [])

  function updateRule(ruleId, nextRule) {
    setDraftRules((current) => current.map((rule) => (rule.id === ruleId ? nextRule : rule)))
  }

  function removeRule(ruleId) {
    setDraftRules((current) => current.filter((rule) => rule.id !== ruleId))
  }

  function addRule() {
    setDraftRules((current) => [...current, createBrowserRule(payload?.defaults?.rule || {})])
  }

  async function saveRules() {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/api/admin/alert-rules`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rules: draftRules,
          comment,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        const details = Array.isArray(body.details) ? body.details.map((item) => item.message).join(' ') : ''
        setError([body.error, details].filter(Boolean).join(' ') || 'Failed to save alert rules')
        return
      }
      setPayload(body)
      setDraftRules(deepClone(body.rules || []))
      setComment('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function sendTest(rule) {
    setTestSendingRuleId(rule.id)
    setError('')
    setTestStatus((current) => ({ ...current, [rule.id]: '' }))
    try {
      const response = await fetch(`${API_BASE}/api/admin/alert-rules/test`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule,
          comment,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        const details = Array.isArray(body.details) ? body.details.map((item) => item.message).join(' ') : ''
        setError([body.error, details].filter(Boolean).join(' ') || 'Failed to send test email')
        return
      }
      setTestStatus((current) => ({
        ...current,
        [rule.id]: `Test email sent to ${body.recipients?.join(', ') || 'configured recipients'}.`,
      }))
      loadPayload()
    } catch (err) {
      setError(err.message)
    } finally {
      setTestSendingRuleId('')
    }
  }

  async function logout() {
    await fetch(`${API_BASE}/api/admin/logout`, { method: 'POST', credentials: 'include' }).catch(() => {})
    window.history.replaceState({}, '', '/admin/login')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const changedCount = useMemo(() => {
    const currentRules = JSON.stringify(payload?.rules || [])
    const draft = JSON.stringify(draftRules || [])
    return currentRules === draft ? 0 : 1
  }, [draftRules, payload])

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
              <div style={{ fontSize: 11, color: '#49d0e2', fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 10 }}>
                Admin Access
              </div>
              <h1 style={{ margin: 0, fontSize: 32 }}>Email Alert Rules</h1>
              <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.7, color: '#c7d5ea', maxWidth: 880 }}>
                Build email alerts off any Halfmann site value or a simple derived expression. Pick a field, compare it to a value or another field, type the recipient emails, and the server will evaluate it every live poll.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <AdminButton tone="blue" onClick={() => {
                window.history.replaceState({}, '', '/admin/derived-trigger-settings')
                window.dispatchEvent(new PopStateEvent('popstate'))
              }}>
                Derived Triggers
              </AdminButton>
              <AdminButton tone="yellow" onClick={loadPayload} disabled={loading || saving}>Refresh</AdminButton>
              <AdminButton tone="red" onClick={logout}>Logout</AdminButton>
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
            Alerts are advisory notifications only. They do not write setpoints or control the field. Use persistence and cooldown to avoid spam from one noisy poll.
          </div>

          {!payload?.email?.configured ? (
            <div style={{
              borderRadius: 18,
              border: '1px solid rgba(239,68,68,0.35)',
              background: 'rgba(39,12,17,0.94)',
              color: '#fecaca',
              padding: 16,
              fontSize: 13,
              lineHeight: 1.7,
            }}>
              Email delivery is not configured yet. Add SMTP env vars on Railway before expecting alert emails to go out: `ALERT_SMTP_HOST`, `ALERT_SMTP_PORT`, `ALERT_SMTP_USER`, `ALERT_SMTP_PASS`, and `ALERT_EMAIL_FROM`.
            </div>
          ) : null}

          {error ? (
            <div style={{
              borderRadius: 16,
              border: '1px solid rgba(239,68,68,0.35)',
              background: 'rgba(39,12,17,0.94)',
              color: '#fecaca',
              padding: 14,
              fontSize: 13,
            }}>
              {error}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <AdminButton tone="green" onClick={addRule} disabled={loading || !payload}>Add Alert Rule</AdminButton>
            <AdminButton tone="blue" onClick={saveRules} disabled={loading || saving || !payload || !changedCount}>
              {saving ? 'Saving…' : 'Save Rules'}
            </AdminButton>
            <div style={{ fontSize: 12, color: '#8ca0be' }}>
              {draftRules.length} rule(s) configured{changedCount ? ' • unsaved changes' : ''}
            </div>
          </div>

          <div>
            <FieldLabel>Change Comment</FieldLabel>
            <TextArea
              rows={2}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Optional reason for this alert-rule change."
            />
          </div>
        </section>

        {loading ? (
          <section style={{
            borderRadius: 24,
            border: '1px solid rgba(73,208,226,0.18)',
            background: 'linear-gradient(180deg, rgba(10,16,27,0.98) 0%, rgba(8,12,20,0.98) 100%)',
            padding: 24,
            color: '#8ca0be',
          }}>
            Loading alert rules…
          </section>
        ) : null}

        {!loading && !draftRules.length ? (
          <section style={{
            borderRadius: 24,
            border: '1px solid rgba(73,208,226,0.18)',
            background: 'linear-gradient(180deg, rgba(10,16,27,0.98) 0%, rgba(8,12,20,0.98) 100%)',
            padding: 24,
            color: '#c7d5ea',
            fontSize: 14,
          }}>
            No email alert rules are configured yet. Add a rule to start watching a datapoint or a simple expression like `Data Point X = Data Point Y - Data Point Z`.
          </section>
        ) : null}

        {!loading ? draftRules.map((rule) => (
          <div key={rule.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <RuleCard
              rule={rule}
              onChange={(nextRule) => updateRule(rule.id, nextRule)}
              onRemove={() => removeRule(rule.id)}
              onSendTest={() => sendTest(rule)}
              testSending={testSendingRuleId === rule.id}
              fieldOptions={fieldOptions}
              deviceOptions={payload?.options?.devices || []}
              comparatorOptions={payload?.options?.comparators || []}
              expressionOperators={payload?.options?.expressionOperators || []}
            />
            {testStatus[rule.id] ? (
              <div style={{
                borderRadius: 14,
                border: '1px solid rgba(31,143,85,0.4)',
                background: 'rgba(7,34,22,0.75)',
                color: '#bbf7d0',
                padding: '10px 12px',
                fontSize: 13,
              }}>
                {testStatus[rule.id]}
              </div>
            ) : null}
          </div>
        )) : null}

        {!loading ? (
          <section style={{
            borderRadius: 24,
            border: '1px solid rgba(73,208,226,0.18)',
            background: 'linear-gradient(180deg, rgba(10,16,27,0.98) 0%, rgba(8,12,20,0.98) 100%)',
            padding: 24,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 16,
          }}>
            <div>
              <div style={{ fontSize: 13, color: '#49d0e2', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>
                Recent Alert Activity
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(payload?.history || []).slice(0, 10).map((event) => (
                  <div key={`${event.ts}-${event.ruleId}-${event.event}`} style={{
                    borderRadius: 14,
                    border: '1px solid rgba(138,183,232,0.14)',
                    background: 'rgba(8,13,22,0.86)',
                    padding: 12,
                    fontSize: 13,
                    color: '#dbeafe',
                  }}>
                    <div style={{ fontWeight: 700 }}>{event.ruleName} — {event.event}</div>
                    <div style={{ color: '#8ca0be', marginTop: 4 }}>{new Date(event.ts).toLocaleString()}</div>
                    <div style={{ color: '#9fb2cd', marginTop: 6 }}>
                      {event.emailStatus ? `Email ${event.emailStatus}` : 'State change recorded'}
                    </div>
                  </div>
                ))}
                {!payload?.history?.length ? <div style={{ color: '#8ca0be', fontSize: 13 }}>No alert activity recorded yet.</div> : null}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, color: '#49d0e2', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>
                Audit Log
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(payload?.auditLog || []).slice(0, 10).map((event, index) => (
                  <div key={`${event.timestamp}-${index}`} style={{
                    borderRadius: 14,
                    border: '1px solid rgba(138,183,232,0.14)',
                    background: 'rgba(8,13,22,0.86)',
                    padding: 12,
                    fontSize: 13,
                    color: '#dbeafe',
                  }}>
                    <div style={{ fontWeight: 700 }}>{event.type}</div>
                    <div style={{ color: '#8ca0be', marginTop: 4 }}>
                      {event.user || 'system'} • {new Date(event.timestamp).toLocaleString()}
                    </div>
                    {event.reason ? <div style={{ color: '#9fb2cd', marginTop: 6 }}>{event.reason}</div> : null}
                  </div>
                ))}
                {!payload?.auditLog?.length ? <div style={{ color: '#8ca0be', fontSize: 13 }}>No alert-rule audit events recorded yet.</div> : null}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
