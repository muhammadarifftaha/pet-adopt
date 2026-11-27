import type React from 'react'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type { IconType } from 'react-icons'


// @pet-adopt/plugin-sdk: the public surface for `pet-adopt.config.ts` and for plugin authors.
// Nothing here touches the database or the browser, and nothing imports the app, so a plugin
// package (in plugins/ here, or published to npm) depends on this package alone.

// --- Roles and permissions ---------------------------------------------------------------------
// One source of truth for what each role may do, shared by the app and plugins. Every server
// action checks a permission (`can`), and the admin's menus and buttons follow the same table.

/** Who can sign in to the admin. */
export const ROLES = ['admin', 'editor', 'developer', 'audit'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_INFO: Record<Role, { label: string; description: string }> = {
  admin: { label: 'Admin', description: 'Everything, including users.' },
  editor: { label: 'Editor', description: 'Pets, pages, media, forms and form responses.' },
  developer: { label: 'Developer', description: 'Pets, pages, media, forms, theme, settings and plugins. No form responses or users.' },
  audit: { label: 'Audit', description: 'Sees everything, changes nothing. Cannot download form responses.' },
}

/**
 * What a permission covers. `pluginContent`, `plugins` and `personalData` are the three levels a
 * plugin screen can ask for (see PluginAccess); the rest are the site's own areas.
 */
export const AREAS = ['pets', 'pages', 'media', 'theme', 'settings', 'plugins', 'users', 'pluginContent', 'personalData'] as const
export type Area = (typeof AREAS)[number]
/**
 * `area:view` or `area:edit`, plus downloading personal data (form responses as CSV) and the
 * activity log: everyone reads their own entries (`activity:own`); admins and audit read everyone's
 * (`activity:view`) and download it (`activity:export`).
 */
export type Permission = `${Area}:${'view' | 'edit'}` | 'personalData:export' | 'activity:own' | 'activity:view' | 'activity:export'

const edit = (...areas: Area[]) => areas.flatMap((area): Permission[] => [`${area}:view`, `${area}:edit`])
const view = (...areas: Area[]) => areas.map((area): Permission => `${area}:view`)

const GRANTS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set<Permission>([...edit(...AREAS), 'personalData:export', 'activity:own', 'activity:view', 'activity:export']),
  editor: new Set<Permission>([...edit('pets', 'pages', 'media', 'pluginContent', 'personalData'), 'personalData:export', 'activity:own']),
  developer: new Set<Permission>([...edit('pets', 'pages', 'media', 'pluginContent', 'theme', 'settings', 'plugins'), 'activity:own']),
  audit: new Set<Permission>([...view(...AREAS), 'activity:own', 'activity:view', 'activity:export']),
}

/** Whether `role` has `permission`. An unknown role has none. */
export function can(role: Role | null | undefined, permission: Permission): boolean {
  return Boolean(role && GRANTS[role]?.has(permission))
}

/** A stored role string as a Role. Anything unknown becomes `audit`, which changes nothing. */
export function asRole(value: unknown): Role {
  return (ROLES as readonly unknown[]).includes(value) ? (value as Role) : 'audit'
}

/**
 * Who a plugin screen or widget is for:
 *  - `all`: the whole team (admins, editors, developers; audit can view). The default.
 *  - `admin`: admins and developers (audit can view): setup, integrations.
 *  - `personalData`: what visitors sent (form responses, sign-ups): admins and editors (audit can
 *    view, developers cannot).
 */
export type PluginAccess = 'all' | 'admin' | 'personalData'

const ACCESS_AREA: Record<PluginAccess, Area> = { all: 'pluginContent', admin: 'plugins', personalData: 'personalData' }

/** The permission a plugin screen or action needs: `accessPermission('personalData', 'edit')`. */
export function accessPermission(access: PluginAccess, level: 'view' | 'edit'): Permission {
  return `${ACCESS_AREA[access]}:${level}`
}

/** A screen's or widget's access, reading the older `adminOnly` flag too. */
export function accessOf(item: { access?: PluginAccess; adminOnly?: boolean }): PluginAccess {
  return item.access ?? (item.adminOnly ? 'admin' : 'all')
}

/** The signed-in person a screen or widget is shown to. The app's session user has this shape. */
export type PluginUser = {
  id: string
  email: string
  name: string
  role: Role
}

/** What a plugin screen or dashboard widget receives. Both are server components by default. */
export type PluginScreenProps = {
  user: PluginUser
  /** Values of `:name` segments in the screen's path (`items/:id` gives `{ id: '3' }`). */
  params: Record<string, string>
  searchParams: Record<string, string | string[] | undefined>
}

export type PluginWidgetProps = { user: PluginUser }

/**
 * An SVG drawn from path data: the `d` of each <path>, in a `viewBox` (default "0 0 24 24"). Filled
 * with the text colour, or drawn as a 2px outline when `outline` is set. Raw markup is not accepted.
 */
export type SvgIcon = {
  viewBox?: string
  paths: string[]
  outline?: boolean
}

/**
 * What a plugin can use as a menu icon, and nothing else: a react-icons icon (`FiStar` from
 * "react-icons/fi") or an `SvgIcon`. Anything else is rejected when the config loads.
 */
export type PluginIcon = IconType | SvgIcon

export type PluginScreen = {
  /**
   * Path under `/admin/plugins/<plugin name>/`. `''` is the plugin's home screen. Segments that
   * start with `:` are parameters (`items/:id`). Screens with parameters never appear in the menu.
   */
  path: string
  /** Page title, and the menu label unless `nav.label` is set. */
  title: string
  component: (props: PluginScreenProps) => React.ReactNode | Promise<React.ReactNode>
  /** Menu label. Defaults to `title`. */
  /**
   * How the screen looks in the menu: `nav: { label: 'Reports', Icon: FiBarChart2 }`. `label`
   * defaults to `title`; `Icon` is a react-icons icon or an `SvgIcon` (a package icon if left out).
   */
  nav?: {
    label?: string
    Icon?: PluginIcon
  }
  /** Leave the screen out of the menu (it is still reachable by URL). */
  hidden?: boolean
  /**
   * Who can open it (see PluginAccess; default `all`). People without access get no menu entry and
   * are sent to the dashboard. The screen's server actions must still check the same level with
   * `host().requirePermission(accessPermission(access, 'view' | 'edit'))`.
   */
  access?: PluginAccess
  /** @deprecated Use `access: 'admin'`. */
  adminOnly?: boolean
}

export type PluginWidget = {
  /** Unique within the plugin. */
  id: string
  title: string
  component: (props: PluginWidgetProps) => React.ReactNode | Promise<React.ReactNode>
  /** Who sees it on the dashboard (see PluginAccess; default `all`). */
  access?: PluginAccess
  /** @deprecated Use `access: 'admin'`. */
  adminOnly?: boolean
}

/** One email. `text` is always sent; `html` is the formatted version, when the sender supports it. */
export type EmailMessage = {
  to: string
  subject: string
  text: string
  html?: string
}

/**
 * How an email plugin reports its setup on its admin page. Never put a secret in `details`: say
 * whether it is set ("Set" / "Not set"), not what it is.
 */
export type EmailStatus = {
  /** The service, e.g. "Resend" or "SMTP". */
  provider: string
  /** Everything it needs is set. While false the site does not offer email (reset links). */
  ready: boolean
  /** Non-secret settings to show, e.g. `{ label: 'Sender', value: 'Pet Adopt <no-reply@…>' }`. */
  details?: Array<{ label: string; value: string }>
  /** How to finish the setup, shown while `ready` is false. */
  setup?: string
}

/**
 * How the site sends email (password reset links). At most one plugin may provide it. `send` runs on
 * the server and should throw when the message was not accepted, so the failure is logged.
 * `status`, when given, is shown on the plugin's admin page; a sender that reports `ready: false`
 * is treated as missing, so the site never offers email it cannot send.
 */
export type EmailSender = {
  send: (message: EmailMessage) => Promise<void>
  status?: () => EmailStatus
}

/**
 * One change to a plugin's tables, written once for each database. Generate them from the plugin's
 * schema with `pnpm plugin:generate <plugin folder>` rather than by hand.
 */
export type PluginMigration = {
  /** Runs in id order: "0000_init", "0001_notes". Never rename, edit or remove one that has shipped. */
  id: string
  /** The SQL. Several statements are separated by `--> statement-breakpoint` lines (drizzle-kit's output). */
  sqlite: string
  pg: string
}

/**
 * Tables a plugin owns. Every table (and index) name starts with `pluginTablePrefix(name)`, so two
 * plugins, or a plugin and the site, can never claim the same table. Plugin tables do not reference
 * the site's own tables. `pnpm migrate` applies the migrations (SQLite also applies them on start);
 * until it has, the plugin's screens show a notice instead and its widgets are left out.
 */
export type PluginStorage = {
  /** The Drizzle tables, as twins (same tables and columns) for each database. */
  tables: { sqlite: Record<string, unknown>; pg: Record<string, unknown> }
  migrations: readonly PluginMigration[]
}

/** "form-builder" -> "plugin_form_builder_": what every table and index of that plugin starts with. */
export const pluginTablePrefix = (pluginName: string) => `plugin_${pluginName.replace(/-/g, '_')}_`

/** The query builder plugins get: Drizzle's async SQLite API, whichever SQLite driver the site uses. */
export type PluginDb = BaseSQLiteDatabase<'async', unknown, Record<string, unknown>>

/**
 * A plugin's tables, opened on the site's database. Write queries once against `t` (typed as the
 * SQLite tables); on PostgreSQL `t` holds the Postgres twins, so the same code runs on both.
 */
export type PluginDatabase<Tables> = {
  dialect: 'sqlite' | 'pg'
  db: PluginDb
  t: Tables
  /** Runs `fn` atomically. `lock` serialises transactions that use the same name (PostgreSQL). */
  withTransaction<T>(fn: (tx: PluginDb) => Promise<T>, options?: { lock?: string }): Promise<T>
}

/** What `definePluginStorage` returns: pass it as the plugin's `storage`, and `open()` it in server code. */
export type PluginStorageHandle<SqliteTables extends Record<string, unknown>, PgTables extends Record<string, unknown>> = PluginStorage & {
  tables: { sqlite: SqliteTables; pg: PgTables }
  /**
   * Opens the plugin's tables. Throws, with a message an owner can act on, until `pnpm migrate`
   * has set them up. Server-only.
   */
  open(): Promise<PluginDatabase<SqliteTables>>
}

type StorageProvider = (storage: PluginStorage) => Promise<PluginDatabase<unknown>>

// On globalThis, so the app and every plugin find the same provider even when the SDK is bundled
// more than once (instrumentation, routes and server actions are separate bundles in one process).
const PROVIDER = Symbol.for('pet-adopt.plugin-storage-provider')
const slot = globalThis as unknown as Record<symbol, StorageProvider | undefined>

/**
 * A plugin's tables and migrations, plus a way to open them. The app does the opening: a plugin
 * never imports the app's database, only this package and drizzle-orm (for its table definitions).
 *
 *   export const storage = definePluginStorage({ tables: { sqlite, pg }, migrations })
 *   definePlugin({ name: 'my-plugin', storage, ... })
 *   const { db, t } = await storage.open()
 */
export function definePluginStorage<SqliteTables extends Record<string, unknown>, PgTables extends Record<string, unknown>>(storage: {
  tables: { sqlite: SqliteTables; pg: PgTables }
  migrations: readonly PluginMigration[]
}): PluginStorageHandle<SqliteTables, PgTables> {
  const handle: PluginStorageHandle<SqliteTables, PgTables> = {
    ...storage,
    async open() {
      const provider = slot[PROVIDER]
      if (!provider) throw new Error('Plugin storage can only be opened inside the Pet Adopt app (no storage provider is registered).')
      return (await provider(handle)) as PluginDatabase<SqliteTables>
    },
  }
  return handle
}

/** For the app only: how plugin storage is opened. Plugins never call this. */
export function provideStorage(provider: StorageProvider): void {
  slot[PROVIDER] = provider
}

export type Plugin = {
  /** Lowercase letters, digits and dashes. Used in the URL, so renaming it moves the screens. */
  name: string
  /** Shown in the admin (menu, plugin list, its page). Defaults to the name, humanised. */
  title?: string
  /** One or two sentences on what it does, shown on its page and in the plugin list. */
  description?: string
  /** Screens that get their own page and menu entry. */
  screens?: PluginScreen[]
  /** Cards shown under the dashboard's numbers. */
  dashboardWidgets?: PluginWidget[]
  /** Sends the site's email. Without one, "email me a reset link" is not offered. */
  email?: EmailSender
  /** Its own tables and the migrations that create them. */
  storage?: PluginStorage
  /**
   * Which of the site's email templates it uses, for the "Used by" column of Email > Sending
   * templates and the warning before one is deleted. Server-only; a failure leaves the column empty.
   */
  emailTemplateUsage?: () => Promise<EmailTemplateUse[]>
  /**
   * Default templates this plugin ships. Each is created in Email > Templates at server
   * start if missing (as `<plugin name>:<key>`), can be edited and restored but not deleted, and is
   * what `sendTemplatedEmail({ fallback })` uses when no other template is picked, so the plugin's
   * emails always have a template.
   */
  emailTemplates?: PluginEmailTemplate[]
  /** Other plugins this one is built from (flattened, in order, before this one). */
  plugins?: Plugin[]
}

/**
 * One place an email template is used: `Form “Adopt” (notification)`, with a link to it. Either the
 * template picked (`templateId`) or, when none is, the plugin's default (`seedKey`, `<plugin>:<key>`).
 */
export type EmailTemplateUse = { templateId?: number; seedKey?: string; label: string; href?: string }

/**
 * A default template a plugin ships. `key`: lowercase letters, digits and dashes, unique in the
 * plugin. `data`: a layout in the site's template format (Puck data of the email builder's blocks);
 * left out, or not valid, the site's built-in email of that purpose is used.
 */
export type PluginEmailTemplate = { key: string; name: string; purpose: PluginEmailPurpose; data?: unknown }

export type Config = {
  plugins?: Plugin[]
}

/** Wrap the project's configuration for type checking: `export default defineConfig({ plugins: [...] })`. */
export function defineConfig(config: Config): Config {
  return config
}

/**
 * Build a plugin. Pass a function to take options, as Sanity does:
 *
 *   export const shelterMap = definePlugin<{ apiKey: string }>((options) => ({
 *     name: 'shelter-map',
 *     screens: [...],
 *   }))
 *   // pet-adopt.config.ts: plugins: [shelterMap({ apiKey: '...' })]
 *
 * Or pass the plugin object itself when there are no options.
 */
export function definePlugin<Options = void>(
  factory: Plugin | ((options: Options) => Plugin),
): (options: Options) => Plugin {
  return (options) => (typeof factory === 'function' ? factory(options) : factory)
}

// --- Errors and action results -------------------------------------------------------------
// The same classes the app throws and understands: an action wrapped in `host().run()` turns a
// ValidationError into field errors and a UserError into its message; anything else is logged and
// shown as a generic failure.

export type FieldErrors = Record<string, string>

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: FieldErrors }

/** One or more fields are invalid. Safe to show to the user. */
export class ValidationError extends Error {
  constructor(
    public fieldErrors: FieldErrors,
    message = 'Please fix the highlighted fields.',
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

/** A rule was broken (not found, still in use, not allowed). The message is safe to show. */
export class UserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserError'
  }
}

// --- Host services -------------------------------------------------------------------------

export type RateRule = { max: number; windowMs: number }

/** Lists of site data a plugin can offer as choices (a form's "Which pet?" question). */
export const CHOICE_SOURCES = ['pets'] as const
export type ChoiceSource = (typeof CHOICE_SOURCES)[number]

/** One choice: `value` is stable (an id), `label` is what people see. */
export type Choice = { value: string; label: string }

/**
 * What the app does for plugins, so a plugin never imports the app. Server-only; get it with
 * `host()` inside a server action or server component (not at module load).
 */
export type PluginHost = {
  /**
   * The signed-in person, if they have `permission`; throws a UserError otherwise. Check the level
   * of the screen the action belongs to: `requirePermission(accessPermission('all', 'edit'))` to
   * change, `'view'` to read.
   */
  requirePermission(permission: Permission): Promise<PluginUser>
  /**
   * Someone who can change the team's plugin content (`pluginContent:edit`: not audit). Use
   * requirePermission with a `view` permission for reads, so audit can see them.
   */
  requireUser(): Promise<PluginUser>
  /** Someone who can change admin-level plugin settings (`plugins:edit`: admins and developers). */
  requireAdmin(): Promise<PluginUser>
  /** Runs `fn` and turns what it throws into an ActionResult (wrap every server action in it). */
  run<T>(fn: () => Promise<T>): Promise<ActionResult<T>>
  /** The visitor's address as the site's proxy reports it, or null when it cannot tell. */
  clientAddress(): Promise<string | null>
  /**
   * Counts one attempt on `key` and throws a UserError ("Too many attempts...") once `rule.max` is
   * passed within `rule.windowMs`. Keys are stored as `plugin:<key>`; start yours with the plugin name.
   */
  consumeAttempt(key: string, rule: RateRule): Promise<void>
  phone: {
    /** True, or why the number cannot be used. Numbers without "+code" use the site's country. */
    validate(raw: string): true | string
    /** The number as E.164 ("+60123456789"), or null when it is not valid. */
    toE164(raw: string): string | null
  }
  /**
   * The current choices from a list of site data, as visitors may see them. `pets`: listed pets that
   * are not adopted, by name (pending ones say so); `value` is the pet's id.
   */
  choices(source: ChoiceSource): Promise<Choice[]>
  /** The site's email sender, or null while no email plugin is set up. */
  emailSender(): Promise<EmailSender | null>
  /** Logs an error without the values a failed database query carries. Never log error objects yourself. */
  logError(error: unknown, context?: string): void
  /**
   * Sends an email through the site's templates (Email > Templates): a team notification
   * or a message to a visitor. Uses the template `templateId` when it exists and has that purpose,
   * else the built-in one. `details` are only used for team notifications (a message to a visitor
   * never repeats what someone typed). Resolves false when the site cannot send email; rejects when
   * sending fails.
   */
  sendTemplatedEmail(message: PluginEmail): Promise<boolean>
  /**
   * The templates for a purpose, for a "which template" choice. `seedKey` marks plugin defaults
   * (`<plugin>:<key>`); pre-select yours when nothing is chosen.
   */
  emailTemplates(purpose: PluginEmailPurpose): Promise<Array<{ id: number; name: string; seedKey: string | null }>>
  /**
   * Adds an entry to the site's activity log, as the signed-in person, after a change succeeded.
   * Never throws (a failure is logged). See PluginActivity.
   */
  recordActivity(entry: PluginActivity): Promise<void>
  /**
   * The site's privacy policy while it is live (`href` is a site path), or null when none is chosen
   * or its page is not published. A plugin that collects personal data should warn while it is null
   * and link to it where visitors type. `settingsHref` is where an admin chooses it.
   */
  privacyPolicy(): Promise<{ policy: { title: string; href: string } | null; settingsHref: string }>
  /**
   * The time zone chosen in Site settings, or null when none is. Pass it to `formatWhen` wherever a
   * screen shows a time, so every screen agrees.
   */
  timeZone(): Promise<string | null>
  /**
   * Encrypts a secret (an API key) for storage, with a key derived from the site's secret, the same
   * way the SMTP password is kept. `purpose` names what it is (`form-builder:captcha`): a value only
   * opens with the purpose it was sealed for. `open` returns null when it cannot be opened (another
   * purpose or site secret, or a changed byte): ask for the secret again then. Never send a secret
   * to a browser.
   */
  secrets: { seal(plain: string, purpose: string): string; open(sealed: string | null, purpose: string): string | null }
}

/** Kinds of email a plugin may send through the site's templates (see `sendTemplatedEmail`). */
export type PluginEmailPurpose = 'team-notification' | 'visitor-message'

export type PluginEmail = {
  purpose: PluginEmailPurpose
  templateId?: number | null
  /** Your default template (`<plugin name>:<key>` from `emailTemplates`), used when `templateId` is missing or deleted. */
  fallback?: string
  to: string
  /** Placeholders: `{ title }` (what it is about, such as a form's name). The site's name and address are added. */
  values?: Record<string, string>
  /** Label and value pairs for the Details block (team notifications only), such as a form's answers. */
  details?: Array<{ label: string; value: string }>
}

/**
 * One line of the activity log, written by a plugin. Record changes (and downloads of personal
 * data), not reads. Never put personal data in it: name the fields that changed, not their values.
 */
export type PluginActivity = {
  /** `<plugin name>.<thing>.<verb>`, such as `form-builder.form.update`. Used to filter. */
  action: string
  /** One sentence, past tense, for people: `Updated the form "Adopt a cat"`. */
  summary: string
  /** What it was done to: an id, and its name as it is now (kept even if it is deleted later). */
  subject?: { id: string | number; label?: string | null }
  /** Field names (or labels) that changed. */
  fields?: string[]
}

/** One CSV cell. Cells a spreadsheet would run as a formula get an apostrophe in front. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

const HOST = Symbol.for('pet-adopt.plugin-host')
const hostSlot = globalThis as unknown as Record<symbol, PluginHost | undefined>

/** The app's services for plugins. Throws outside the app (a plugin's own tests should stub it). */
export function host(): PluginHost {
  const current = hostSlot[HOST]
  if (!current) throw new Error('Plugin host services are only available inside the Pet Adopt app.')
  return current
}

/** For the app only. Plugins never call this. */
export function provideHost(services: PluginHost): void {
  hostSlot[HOST] = services
}

// --- Dates and times -------------------------------------------------------------------------

/**
 * The time zone a site shows its times in (Site settings), as an IANA name such as
 * "Asia/Kuala_Lumpur"; null means none was chosen and each person sees their own device's time.
 */
export type SiteTimeZone = string | null | undefined

/** Whether a string is a time zone this runtime knows ("Asia/Kuala_Lumpur", "UTC"). */
export function isTimeZone(value: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(value)) return false
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value })
    return true
  } catch {
    return false
  }
}

const usable = (timeZone: SiteTimeZone) => (timeZone && isTimeZone(timeZone) ? timeZone : undefined)

export type WhenStyle = 'date' | 'dateTime' | 'longDate'

const whenFormats = new Map<string, Intl.DateTimeFormat>()

/**
 * A date as the admin shows it: "27 Nov 2026, 18:46" (`dateTime`, the default), "27 Nov 2026"
 * (`date`) or "27 November 2026" (`longDate`), in the site's time zone. Without one (or with a name
 * this runtime does not know) the runtime's own zone is used: the viewer's in a browser, the
 * server's on the server. One fixed locale, so the server and the browser draw the same text.
 */
export function formatWhen(value: Date | string | number, timeZone?: SiteTimeZone, style: WhenStyle = 'dateTime'): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const zone = usable(timeZone)
  const key = `${style}|${zone ?? ''}`
  let format = whenFormats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', {
      dateStyle: style === 'longDate' ? 'long' : 'medium',
      ...(style === 'dateTime' ? { timeStyle: 'short' as const } : {}),
      timeZone: zone,
    })
    whenFormats.set(key, format)
  }
  return format.format(date)
}

const partFormats = new Map<string, Intl.DateTimeFormat>()

/** The calendar date and clock time an instant has in a time zone. */
function wallClock(at: number, timeZone: string) {
  let format = partFormats.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    partFormats.set(timeZone, format)
  }
  const parts: Record<string, number> = {}
  for (const part of format.formatToParts(new Date(at))) if (part.type !== 'literal') parts[part.type] = Number(part.value)
  return parts as { year: number; month: number; day: number; hour: number; minute: number; second: number }
}

const pad = (value: number) => String(value).padStart(2, '0')

/** The day (`YYYY-MM-DD`) an instant falls on in the site's time zone (the runtime's without one). */
export function dayInZone(value: Date | string | number, timeZone?: SiteTimeZone): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const zone = usable(timeZone)
  if (!zone) return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const clock = wallClock(date.getTime(), zone)
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`
}

/**
 * The instant a day (`YYYY-MM-DD`) starts at in the site's time zone (the runtime's without one),
 * or with `addDays` that many days later. Null for anything that is not a real date.
 */
export function startOfDayInZone(day: string, timeZone?: SiteTimeZone, addDays = 0): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return null
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const real = new Date(Date.UTC(year, month - 1, date))
  if (real.getUTCFullYear() !== year || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== date) return null
  const zone = usable(timeZone)
  if (!zone) return new Date(year, month - 1, date + addDays)
  // Midnight as if the zone were UTC, then moved by the zone's offset at that moment. The offset is
  // read again at the result, because the first guess can sit on the other side of a clock change.
  const wanted = Date.UTC(year, month - 1, date + addDays)
  const offsetAt = (at: number) => {
    const clock = wallClock(at, zone)
    return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second) - at
  }
  const first = wanted - offsetAt(wanted)
  return new Date(wanted - offsetAt(first))
}

// --- Search ----------------------------------------------------------------------------------

/**
 * Text as searches compare it: Unicode-normalised, accents removed and lower-cased ("Île" -> "ile",
 * "Café" -> "cafe"). Done in JavaScript, not with SQL lower(), because SQLite and libSQL (Turso)
 * only fold A-Z there; searchable text is stored folded and the search term is folded the same way,
 * so every database gives the same results.
 */
export function foldText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
}

