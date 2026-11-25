import type React from 'react'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { IconType } from 'react-icons'


// @pet-adopt/plugin-sdk: the public surface for `pet-adopt.config.ts` and for plugin authors.
// Nothing here touches the database or the browser, and nothing imports the app, so a plugin
// package (in plugins/ here, or published to npm) depends on this package alone.

/** The signed-in person a screen or widget is shown to. The app's session user has this shape. */
export type PluginUser = {
  id: string
  email: string
  name: string
  role: 'admin' | 'editor'
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
  /** Only admins can open it. Editors get no menu entry and are redirected to the dashboard. */
  adminOnly?: boolean
}

export type PluginWidget = {
  /** Unique within the plugin. */
  id: string
  title: string
  component: (props: PluginWidgetProps) => React.ReactNode | Promise<React.ReactNode>
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

/**
 * A plugin's tables, opened on the site's database. Write queries once against `t` (typed as the
 * SQLite tables); on PostgreSQL `t` holds the Postgres twins, so the same code runs on both.
 */
export type PluginDatabase<Tables> = {
  dialect: 'sqlite' | 'pg'
  db: BetterSQLite3Database<Record<string, unknown>>
  t: Tables
  /** Runs `fn` atomically. `lock` serialises transactions that use the same name (PostgreSQL). */
  withTransaction<T>(fn: (tx: BetterSQLite3Database<Record<string, unknown>>) => Promise<T>, options?: { lock?: string }): Promise<T>
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
  /** Other plugins this one is built from (flattened, in order, before this one). */
  plugins?: Plugin[]
}

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
  /** The signed-in person; throws a UserError when nobody is. */
  requireUser(): Promise<PluginUser>
  /** The signed-in admin; throws a UserError otherwise. */
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
  emailSender(): EmailSender | null
  /** Logs an error without the values a failed database query carries. Never log error objects yourself. */
  logError(error: unknown, context?: string): void
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

