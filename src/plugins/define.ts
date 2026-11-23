import type React from 'react'
import type { IconType } from 'react-icons'

import type { SessionUser } from '@/server/types'

// The public surface for `pet-adopt.config.ts` and for plugin authors. Nothing here touches the
// database or the browser, so a plugin package can import it safely.

/** What a plugin screen or dashboard widget receives. Both are server components by default. */
export type PluginScreenProps = {
  user: SessionUser
  /** Values of `:name` segments in the screen's path (`items/:id` gives `{ id: '3' }`). */
  params: Record<string, string>
  searchParams: Record<string, string | string[] | undefined>
}

export type PluginWidgetProps = { user: SessionUser }

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

export type Plugin = {
  /** Lowercase letters, digits and dashes. Used in the URL, so renaming it moves the screens. */
  name: string
  /** Screens that get their own page and menu entry. */
  screens?: PluginScreen[]
  /** Cards shown under the dashboard's numbers. */
  dashboardWidgets?: PluginWidget[]
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
