import nodemailer from 'nodemailer'

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function parsePort(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

export function getEmailConfig() {
  const host = String(process.env.ALERT_SMTP_HOST || process.env.SMTP_HOST || '').trim()
  const port = parsePort(process.env.ALERT_SMTP_PORT || process.env.SMTP_PORT) || 587
  const user = String(process.env.ALERT_SMTP_USER || process.env.SMTP_USER || '').trim()
  const pass = String(process.env.ALERT_SMTP_PASS || process.env.SMTP_PASS || '').trim()
  const from = String(process.env.ALERT_EMAIL_FROM || process.env.SMTP_FROM || user || '').trim()
  const replyTo = String(process.env.ALERT_EMAIL_REPLY_TO || process.env.SMTP_REPLY_TO || '').trim()
  const secure = parseBoolean(process.env.ALERT_SMTP_SECURE || process.env.SMTP_SECURE, port === 465)
  const configured = Boolean(host && port && user && pass && from)

  return {
    configured,
    host,
    port,
    user,
    pass,
    from,
    replyTo: replyTo || null,
    secure,
  }
}

let cachedTransportKey = ''
let cachedTransporter = null

function buildTransportKey(config) {
  return JSON.stringify({
    host: config.host,
    port: config.port,
    user: config.user,
    pass: config.pass ? 'configured' : '',
    secure: config.secure,
  })
}

function getTransporter(config) {
  const nextKey = buildTransportKey(config)
  if (cachedTransporter && cachedTransportKey === nextKey) return cachedTransporter

  cachedTransportKey = nextKey
  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  })
  return cachedTransporter
}

export async function sendAlertEmail({ to, subject, text }) {
  const config = getEmailConfig()
  if (!config.configured) {
    const error = new Error('Email delivery is not configured')
    error.code = 'EMAIL_NOT_CONFIGURED'
    throw error
  }

  const recipients = Array.isArray(to)
    ? to.map((entry) => String(entry || '').trim()).filter(Boolean)
    : String(to || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)

  if (!recipients.length) {
    const error = new Error('No recipients provided')
    error.code = 'EMAIL_NO_RECIPIENTS'
    throw error
  }

  const transporter = getTransporter(config)
  return transporter.sendMail({
    from: config.from,
    replyTo: config.replyTo || undefined,
    to: recipients.join(', '),
    subject,
    text,
  })
}
