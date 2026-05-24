import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import bcrypt from 'bcryptjs'
import { logDerivedTriggerSettingsAuditEvent } from './derivedTriggerSettingsStore.js'

const COOKIE_NAME = 'halfmann_admin_session'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const MAX_LOGIN_ATTEMPTS = 5

const SESSIONS = new Map()
const LOGIN_ATTEMPTS = new Map()

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url')
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    String(cookieHeader || '')
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const divider = entry.indexOf('=')
        if (divider === -1) return [entry, '']
        return [entry.slice(0, divider), decodeURIComponent(entry.slice(divider + 1))]
      }),
  )
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim()
  return req.ip || req.socket?.remoteAddress || 'unknown'
}

function getSecret() {
  return String(process.env.ADMIN_SESSION_SECRET || '').trim()
}

function getConfiguredUsername() {
  return String(process.env.ADMIN_USERNAME || '').trim()
}

function getConfiguredHash() {
  return String(process.env.ADMIN_PASSWORD_HASH || '').trim()
}

function buildSignature(payload) {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

function serializeCookie(value, req) {
  const secure = process.env.NODE_ENV === 'production' || req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https')
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

function serializeClearedCookie(req) {
  const secure = process.env.NODE_ENV === 'production' || req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https')
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

function getLoginBucket(ip) {
  const now = Date.now()
  const bucket = LOGIN_ATTEMPTS.get(ip) || []
  const filtered = bucket.filter((ts) => now - ts < LOGIN_WINDOW_MS)
  LOGIN_ATTEMPTS.set(ip, filtered)
  return filtered
}

export function getAdminAuthStatus() {
  return {
    configured: Boolean(getConfiguredUsername() && getConfiguredHash() && getSecret()),
  }
}

export function issueAdminSession(res, req, username) {
  const sessionId = randomBytes(24).toString('hex')
  const expiresAt = Date.now() + SESSION_TTL_MS
  const payload = JSON.stringify({ sid: sessionId, exp: expiresAt, usr: username })
  const encoded = base64UrlEncode(payload)
  const signature = buildSignature(encoded)
  SESSIONS.set(sessionId, {
    username,
    expiresAt,
    createdAt: new Date().toISOString(),
    ip: getClientIp(req),
  })
  res.setHeader('Set-Cookie', serializeCookie(`${encoded}.${signature}`, req))
}

export function clearAdminSession(res, req) {
  const session = getAdminSession(req)
  if (session?.sid) SESSIONS.delete(session.sid)
  res.setHeader('Set-Cookie', serializeClearedCookie(req))
}

export function getAdminSession(req) {
  try {
    const cookieValue = parseCookies(req.headers.cookie || '')[COOKIE_NAME]
    if (!cookieValue) return null
    const [encoded, signature] = String(cookieValue).split('.')
    if (!encoded || !signature || !getSecret()) return null
    const expected = buildSignature(encoded)
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
    const payload = JSON.parse(base64UrlDecode(encoded))
    if (!payload?.sid || !payload?.exp || Date.now() > payload.exp) {
      if (payload?.sid) SESSIONS.delete(payload.sid)
      return null
    }
    const active = SESSIONS.get(payload.sid)
    if (!active || Date.now() > active.expiresAt) {
      SESSIONS.delete(payload.sid)
      return null
    }
    return {
      sid: payload.sid,
      username: active.username,
      expiresAt: active.expiresAt,
      createdAt: active.createdAt,
    }
  } catch {
    return null
  }
}

export function requireAdmin(req, res, next) {
  const session = getAdminSession(req)
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  req.adminSession = session
  return next()
}

export async function verifyAdminLogin({ username, password, req }) {
  const ip = getClientIp(req)
  const bucket = getLoginBucket(ip)
  if (bucket.length >= MAX_LOGIN_ATTEMPTS) {
    logDerivedTriggerSettingsAuditEvent({
      type: 'admin-login-rate-limited',
      user: username || 'unknown',
      ip,
      success: false,
      note: 'Too many login attempts',
    })
    const error = new Error('Too many login attempts. Try again later.')
    error.status = 429
    throw error
  }

  const configured = getAdminAuthStatus().configured
  if (!configured) {
    const error = new Error('Admin authentication is not configured')
    error.status = 503
    throw error
  }

  const expectedUsername = getConfiguredUsername()
  const expectedHash = getConfiguredHash()
  const usernameOk = username === expectedUsername
  const passwordOk = await bcrypt.compare(String(password || ''), expectedHash)
  const success = usernameOk && passwordOk

  if (!success) {
    bucket.push(Date.now())
    LOGIN_ATTEMPTS.set(ip, bucket)
    logDerivedTriggerSettingsAuditEvent({
      type: 'admin-login-failed',
      user: username || 'unknown',
      ip,
      success: false,
      note: 'Invalid credentials',
    })
    const error = new Error('Invalid credentials')
    error.status = 401
    throw error
  }

  LOGIN_ATTEMPTS.delete(ip)
  logDerivedTriggerSettingsAuditEvent({
    type: 'admin-login-success',
    user: username,
    ip,
    success: true,
    note: 'Admin authenticated',
  })

  return { username, ip }
}
