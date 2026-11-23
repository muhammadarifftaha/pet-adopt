import type { AdminNavItem, NavIcon } from '@/components/admin/nav-items'

import config from '../../pet-adopt.config'
import type { Plugin, PluginScreen, PluginWidget } from './define'
import { IconError, toNavIcon } from './icon'

// Reads `pet-adopt.config.ts` once, flattens nested plugins, checks them, and answers the questions
// the admin asks: which menu entries, which screen for this URL, which dashboard widgets.
// Server-only: plugin components are functions and never go to the browser.

export type ResolvedScreen = PluginScreen & {
  plugin: string
  segments: string[]
  href: string
  /** The screen's icon as plain data, checked when the config loads. */
  navIcon?: NavIcon
}
export type ResolvedWidget = PluginWidget & { plugin: string }

type Registry = { plugins: Plugin[]; screens: ResolvedScreen[]; widgets: ResolvedWidget[] }

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const LITERAL_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const PARAM_SEGMENT = /^:[a-zA-Z][a-zA-Z0-9]*$/

export const PLUGIN_BASE = '/admin/plugins'

function flatten(list: Plugin[], out: Plugin[] = []): Plugin[] {
  for (const plugin of list) {
    flatten(plugin.plugins ?? [], out)
    out.push(plugin)
  }
  return out
}

function build(): Registry {
  const plugins = flatten(config.plugins ?? [])
  const seenNames = new Set<string>()
  const screens: ResolvedScreen[] = []
  const widgets: ResolvedWidget[] = []

  for (const plugin of plugins) {
    const who = `Plugin "${plugin.name}"`
    if (!NAME.test(plugin.name)) {
      throw new Error(`Plugin name "${plugin.name}" must be lowercase letters, digits and dashes.`)
    }
    if (seenNames.has(plugin.name)) {
      throw new Error(`${who} is registered twice. Names must be unique.`)
    }
    seenNames.add(plugin.name)

    const seenPaths = new Set<string>()
    for (const screen of plugin.screens ?? []) {
      const segments = screen.path.split('/').filter(Boolean)
      for (const segment of segments) {
        if (!LITERAL_SEGMENT.test(segment) && !PARAM_SEGMENT.test(segment)) {
          throw new Error(`${who}: screen path "${screen.path}" has an invalid segment "${segment}".`)
        }
      }
      // `items/:a` and `items/:b` match the same URLs, so compare with parameter names removed.
      const shape = segments.map((s) => (s.startsWith(':') ? ':' : s)).join('/')
      if (seenPaths.has(shape)) throw new Error(`${who}: two screens match the path "${screen.path}".`)
      seenPaths.add(shape)

      let navIcon: NavIcon | undefined
      if (screen.nav?.Icon !== undefined) {
        try {
          navIcon = toNavIcon(screen.nav.Icon)
        } catch (error) {
          const reason = error instanceof IconError ? error.message : String(error)
          throw new Error(`${who}: nav.Icon of screen "${screen.path || '(home)'}": ${reason}`)
        }
      }

      screens.push({
        ...screen,
        plugin: plugin.name,
        segments,
        href: [PLUGIN_BASE, plugin.name, ...segments].join('/'),
        navIcon,
      })
    }

    const seenWidgets = new Set<string>()
    for (const widget of plugin.dashboardWidgets ?? []) {
      if (seenWidgets.has(widget.id)) throw new Error(`${who}: widget id "${widget.id}" is used twice.`)
      seenWidgets.add(widget.id)
      widgets.push({ ...widget, plugin: plugin.name })
    }
  }

  return { plugins, screens, widgets }
}

let cached: Registry | undefined
function registry(): Registry {
  return (cached ??= build())
}

/** Menu entries for every screen that has no parameters and is not hidden. */
export function getPluginNav(): AdminNavItem[] {
  return registry()
    .screens.filter((s) => !s.hidden && !s.segments.some((seg) => seg.startsWith(':')))
    .map((s) => ({ href: s.href, label: s.nav?.label ?? s.title, adminOnly: s.adminOnly, icon: s.navIcon }))
}

export function getPluginWidgets(): ResolvedWidget[] {
  return registry().widgets
}

/** The screen for `/admin/plugins/<plugin>/<...segments>`, with its parameter values. */
export function findPluginScreen(
  plugin: string,
  segments: string[],
): { screen: ResolvedScreen; params: Record<string, string> } | null {
  const candidates = registry()
    .screens.filter((s) => s.plugin === plugin && s.segments.length === segments.length)
    // Fewer parameters first, so `items/new` beats `items/:id`.
    .sort((a, b) => count(a.segments) - count(b.segments))

  for (const screen of candidates) {
    const params: Record<string, string> = {}
    const matches = screen.segments.every((seg, i) => {
      if (seg.startsWith(':')) {
        params[seg.slice(1)] = segments[i]
        return true
      }
      return seg === segments[i]
    })
    if (matches) return { screen, params }
  }
  return null
}

function count(segments: string[]): number {
  return segments.filter((s) => s.startsWith(':')).length
}
