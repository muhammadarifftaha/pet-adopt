import type React from 'react'
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
