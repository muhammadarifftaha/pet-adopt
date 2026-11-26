// The site's email (password reset links, form notifications, test emails). Agreed with the owner:
//  - Built in: a generic SMTP sender, configured in Settings > Email by admins and developers
//    (`settings:edit`; audit can view). Every provider that matters offers SMTP.
//  - Environment variables override single fields (SMTP_HOST, SMTP_PORT, SMTP_SECURITY, SMTP_USER,
//    SMTP_PASSWORD, EMAIL_FROM, EMAIL_REPLY_TO); the form shows those read-only.
//  - The password is stored encrypted (secret-box.ts) and never sent to a browser: the form only
//    learns whether one is set.
//  - A plugin may still provide `email: { send }` (an HTTP API where SMTP ports are blocked). When it
//    is ready it is used instead of SMTP.
import { type EmailMessage, type EmailSender, type EmailStatus } from '@pet-adopt/plugin-sdk'
import { eq } from 'drizzle-orm'
import nodemailer from 'nodemailer'

import { getDatabase } from '@/db/client'
import { getEmailPlugin } from '@/plugins/registry'

import { asRecord, Fields, ValidationError } from './result'
import { open, seal } from './secret-box'

export const SMTP_SECURITY = [
  { value: 'starttls', label: 'STARTTLS (usually port 587)' },
  { value: 'tls', label: 'SSL/TLS (usually port 465)' },
  { value: 'none', label: 'None, not encrypted (local test servers only)' },
] as const
export type SmtpSecurity = (typeof SMTP_SECURITY)[number]['value']
const DEFAULT_PORT: Record<SmtpSecurity, number> = { starttls: 587, tls: 465, none: 25 }

export type EmailField = 'host' | 'port' | 'security' | 'username' | 'password' | 'fromName' | 'fromAddress' | 'replyTo'

/** The environment variable that overrides each field. EMAIL_FROM covers the sender's name and address. */
export const EMAIL_ENV: Record<EmailField, string> = {
  host: 'SMTP_HOST',
  port: 'SMTP_PORT',
  security: 'SMTP_SECURITY',
  username: 'SMTP_USER',
  password: 'SMTP_PASSWORD',
  fromName: 'EMAIL_FROM',
  fromAddress: 'EMAIL_FROM',
  replyTo: 'EMAIL_REPLY_TO',
}

const PASSWORD_PURPOSE = 'smtp-password'
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/
// A host name or an IP address; no scheme, path or port.
const HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$|^\[?[0-9A-Fa-f:.]+\]?$/

const validHost = (value: string) => (value.length <= 253 && HOST.test(value) ? true : 'Enter a host name such as smtp.example.com, without https:// or a port.')
const validEmail = (value: string) => (value.length <= 254 && EMAIL.test(value) ? true : 'Enter an email address, like name@example.com.')

type Stored = {
  host: string | null
  port: number | null
  security: SmtpSecurity
  username: string | null
  passwordEncrypted: string | null
  fromName: string | null
  fromAddress: string | null
  replyTo: string | null
}

export type SmtpConfig = {
  host: string | null
  port: number
  security: SmtpSecurity
  username: string | null
  password: string | null
  fromName: string | null
  fromAddress: string | null
  replyTo: string | null
}

/** "Pet Adopt <no-reply@example.com>" or a bare address, as EMAIL_FROM holds it. */
export function parseFrom(value: string): { name: string | null; address: string } | null {
  const text = value.trim()
  const match = /^(?:"?([^"<>]*?)"?\s*)?<([^<>]+)>$/.exec(text)
  const address = (match ? match[2] : text).trim()
  if (validEmail(address) !== true) return null
  const name = match?.[1]?.trim() || null
  return { name, address }
}

/** What the environment sets, field by field, and what in it is wrong. */
function fromEnv(env: NodeJS.ProcessEnv = process.env) {
  const values: Partial<SmtpConfig> = {}
  const problems: string[] = []
  const read = (name: string) => {
    const value = env[name]?.trim()
    return value ? value : undefined
  }
  const host = read('SMTP_HOST')
  if (host !== undefined) {
    if (validHost(host) === true) values.host = host
    else problems.push('SMTP_HOST is not a host name.')
  }
  const port = read('SMTP_PORT')
  if (port !== undefined) {
    const n = Number(port)
    if (/^\d+$/.test(port) && n >= 1 && n <= 65535) values.port = n
    else problems.push('SMTP_PORT must be a number from 1 to 65535.')
  }
  const security = read('SMTP_SECURITY')?.toLowerCase()
  if (security !== undefined) {
    if (SMTP_SECURITY.some((option) => option.value === security)) values.security = security as SmtpSecurity
    else problems.push('SMTP_SECURITY must be starttls, tls or none.')
  }
  const username = read('SMTP_USER')
  if (username !== undefined) values.username = username
  // The password may legitimately start or end with spaces: take it as it is.
  if (env.SMTP_PASSWORD) values.password = env.SMTP_PASSWORD
  const from = read('EMAIL_FROM')
  if (from !== undefined) {
    const parsed = parseFrom(from)
    if (parsed) {
      values.fromAddress = parsed.address
      values.fromName = parsed.name
    } else problems.push('EMAIL_FROM must be an address, or a name and an address like "Pet Adopt <no-reply@example.com>".')
  }
  const replyTo = read('EMAIL_REPLY_TO')
  if (replyTo !== undefined) {
    if (validEmail(replyTo) === true) values.replyTo = replyTo
    else problems.push('EMAIL_REPLY_TO is not an email address.')
  }
  // Which fields the environment decides (even when its value was wrong, so the form stays locked).
  const locked = new Set<EmailField>()
  for (const [field, name] of Object.entries(EMAIL_ENV) as Array<[EmailField, string]>) {
    if (field === 'password' ? env.SMTP_PASSWORD : read(name)) locked.add(field)
  }
  return { values, problems, locked }
}

async function readStored(): Promise<Stored | null> {
  const { db, t } = await getDatabase()
  const [row] = await db.select().from(t.emailSettings).where(eq(t.emailSettings.id, 1)).limit(1)
  if (!row) return null
  const security = SMTP_SECURITY.some((option) => option.value === row.security) ? (row.security as SmtpSecurity) : 'starttls'
  return {
    host: row.host,
    port: row.port,
    security,
    username: row.username,
    passwordEncrypted: row.passwordEncrypted,
    fromName: row.fromName,
    fromAddress: row.fromAddress,
    replyTo: row.replyTo,
  }
}

export type ResolvedSmtp = {
  config: SmtpConfig
  /** Fields the environment decides. */
  locked: Set<EmailField>
  /** A password is stored (encrypted) in the database. */
  passwordStored: boolean
  /** A stored password could not be decrypted (BETTER_AUTH_SECRET changed): enter it again. */
  passwordUnreadable: boolean
  /** What stops sending, for people. Empty when ready. */
  problems: string[]
  ready: boolean
}

/** The SMTP settings in effect: the environment's fields over the stored ones. */
export async function resolveSmtp(env: NodeJS.ProcessEnv = process.env): Promise<ResolvedSmtp> {
  const stored = await readStored()
  const environment = fromEnv(env)
  const stash = stored?.passwordEncrypted ?? null
  const decrypted = open(stash, PASSWORD_PURPOSE)
  const security = environment.values.security ?? stored?.security ?? 'starttls'
  const pick = <K extends keyof SmtpConfig>(field: EmailField, key: K, storedValue: SmtpConfig[K]): SmtpConfig[K] =>
    environment.locked.has(field) ? ((environment.values[key] ?? null) as SmtpConfig[K]) : storedValue
  const config: SmtpConfig = {
    host: pick('host', 'host', stored?.host ?? null),
    port: environment.values.port ?? stored?.port ?? DEFAULT_PORT[security],
    security,
    username: pick('username', 'username', stored?.username ?? null),
    password: pick('password', 'password', decrypted),
    fromName: pick('fromName', 'fromName', stored?.fromName ?? null),
    fromAddress: pick('fromAddress', 'fromAddress', stored?.fromAddress ?? null),
    replyTo: pick('replyTo', 'replyTo', stored?.replyTo ?? null),
  }
  const passwordUnreadable = !environment.locked.has('password') && Boolean(stash) && decrypted === null
  const problems = [...environment.problems]
  if (!config.host) problems.push('Enter the SMTP server (host).')
  if (!config.fromAddress) problems.push('Enter the address emails are sent from.')
  if (passwordUnreadable) problems.push('The saved password can no longer be read (the site’s secret changed). Enter it again.')
  else if (config.username && !config.password) problems.push('Enter the password for the SMTP user.')
  return { config, locked: environment.locked, passwordStored: Boolean(stash), passwordUnreadable, problems, ready: problems.length === 0 }
}

// --- The settings form -----------------------------------------------------------------------

/** What the Email settings screen shows. Never the password. */
export type EmailSettingsView = {
  host: string | null
  port: number
  security: SmtpSecurity
  username: string | null
  fromName: string | null
  fromAddress: string | null
  replyTo: string | null
  passwordSet: boolean
  passwordUnreadable: boolean
  /** Fields set by environment variables (read-only in the form), with the variable's name. */
  locked: Partial<Record<EmailField, string>>
  ready: boolean
  problems: string[]
  /** A plugin that can send the site's email instead (used while it is set up). */
  plugin: { name: string; ready: boolean } | null
}

export async function getEmailSettingsView(): Promise<EmailSettingsView> {
  const smtp = await resolveSmtp()
  const { config } = smtp
  const plugin = getEmailPlugin()
  const locked: Partial<Record<EmailField, string>> = {}
  for (const field of smtp.locked) locked[field] = EMAIL_ENV[field]
  return {
    host: config.host,
    port: config.port,
    security: config.security,
    username: config.username,
    fromName: config.fromName,
    fromAddress: config.fromAddress,
    replyTo: config.replyTo,
    passwordSet: smtp.locked.has('password') || (smtp.passwordStored && !smtp.passwordUnreadable),
    passwordUnreadable: smtp.passwordUnreadable,
    locked,
    ready: smtp.ready,
    problems: smtp.problems,
    plugin: plugin ? { name: plugin.plugin, ready: plugin.sender.status ? plugin.sender.status().ready : true } : null,
  }
}

const STORED_LABELS: Record<keyof Stored, string> = {
  host: 'server',
  port: 'port',
  security: 'encryption',
  username: 'user name',
  passwordEncrypted: 'password',
  fromName: 'sender name',
  fromAddress: 'sender address',
  replyTo: 'reply-to address',
}

/**
 * Saves the form: `{ host, port, security, username, password?, clearPassword?, fromName, fromAddress,
 * replyTo }`. A missing or empty `password` keeps the stored one; `clearPassword: true` removes it.
 * Fields the environment sets are ignored. Returns which fields changed (labels, never values).
 */
export async function saveEmailSettings(raw: unknown): Promise<{ changed: string[] }> {
  const input = asRecord(raw)
  const { locked } = fromEnv()
  const f = new Fields(input)
  const host = f.text('host', 253, { validate: validHost })
  const port = f.number('port', { min: 1, max: 65535 })
  if (typeof port === 'number' && !Number.isInteger(port)) f.fail_('port', 'Enter a whole number.')
  const security = f.oneOf('security', SMTP_SECURITY)
  const username = f.text('username', 254)
  const fromName = f.text('fromName', 100, { collapse: true })
  const fromAddress = f.text('fromAddress', 254, { validate: validEmail })
  const replyTo = f.text('replyTo', 254, { validate: validEmail })
  const password = input.password
  if (password !== undefined && password !== null && (typeof password !== 'string' || password.length > 500)) f.fail_('password', 'Use at most 500 characters.')
  const clearPassword = f.flag('clearPassword')
  f.done()

  const before = await readStored()
  const next: Stored = before
    ? { ...before }
    : { host: null, port: null, security: 'starttls', username: null, passwordEncrypted: null, fromName: null, fromAddress: null, replyTo: null }
  const set = <K extends keyof Stored>(field: EmailField, key: K, value: Stored[K] | undefined) => {
    if (value !== undefined && !locked.has(field)) next[key] = value
  }
  set('host', 'host', host)
  set('port', 'port', port)
  set('security', 'security', security ?? undefined)
  set('username', 'username', username)
  set('fromName', 'fromName', fromName)
  set('fromAddress', 'fromAddress', fromAddress)
  set('replyTo', 'replyTo', replyTo)
  if (!locked.has('password')) {
    if (clearPassword) next.passwordEncrypted = null
    else if (typeof password === 'string' && password) next.passwordEncrypted = seal(password, PASSWORD_PURPOSE)
  }

  // Once there is a server, it needs an address to send from.
  const hasHost = locked.has('host') || Boolean(next.host)
  const hasFrom = locked.has('fromAddress') || Boolean(next.fromAddress)
  if (hasHost && !hasFrom) throw new ValidationError({ fromAddress: 'Enter the address emails are sent from.' })

  const { db, t } = await getDatabase()
  await db
    .insert(t.emailSettings)
    .values({ id: 1, ...next })
    .onConflictDoUpdate({ target: t.emailSettings.id, set: { ...next, updatedAt: new Date() } })

  const empty: Stored = { host: null, port: null, security: 'starttls', username: null, passwordEncrypted: null, fromName: null, fromAddress: null, replyTo: null }
  const previous = before ?? empty
  const changed = (Object.keys(STORED_LABELS) as Array<keyof Stored>).filter((key) => previous[key] !== next[key])
  return { changed: changed.map((key) => STORED_LABELS[key]) }
}

// --- Sending -----------------------------------------------------------------------------------

const TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 }

/** Sends one message over SMTP with these settings. Throws with the server's explanation. */
export async function sendWithSmtp(config: SmtpConfig, message: EmailMessage): Promise<void> {
  if (!config.host || !config.fromAddress) throw new Error('Email is not set up: the server or the sender address is missing.')
  const transport = nodemailer.createTransport({
    host: config.host.replace(/^\[|\]$/g, ''),
    port: config.port,
    secure: config.security === 'tls',
    // `none`: encryption is not required (a server that offers STARTTLS is still used with it).
    requireTLS: config.security === 'starttls',
    auth: config.username ? { user: config.username, pass: config.password ?? '' } : undefined,
    tls: { minVersion: 'TLSv1.2' },
    ...TIMEOUTS,
  })
  try {
    await transport.sendMail({
      from: config.fromName ? { name: config.fromName, address: config.fromAddress } : config.fromAddress,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(config.replyTo ? { replyTo: config.replyTo } : {}),
    })
  } finally {
    transport.close()
  }
}

function smtpStatus(smtp: ResolvedSmtp): EmailStatus {
  const { config } = smtp
  return {
    provider: 'SMTP',
    ready: smtp.ready,
    details: [
      { label: 'Server', value: config.host ? `${config.host}:${config.port}` : 'Not set' },
      { label: 'Sender', value: config.fromAddress ? (config.fromName ? `${config.fromName} <${config.fromAddress}>` : config.fromAddress) : 'Not set' },
    ],
    setup: 'Fill in Settings > Email, or set the SMTP_* and EMAIL_FROM environment variables.',
  }
}

/**
 * The site's email sender, or null when nothing is set up (the site then does not offer email, such
 * as reset links, rather than offer it and fail). A ready email plugin wins; otherwise built-in SMTP.
 */
export async function getEmailSender(): Promise<EmailSender | null> {
  const plugin = getEmailPlugin()
  if (plugin && (!plugin.sender.status || plugin.sender.status().ready)) return plugin.sender
  const smtp = await resolveSmtp()
  if (!smtp.ready) return null
  return { send: (message) => sendWithSmtp(smtp.config, message), status: () => smtpStatus(smtp) }
}
