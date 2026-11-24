import { FiMail } from 'react-icons/fi'

import type { AdminNavItem, NavIcon } from '@/components/admin/nav-items'

import config from '../../pet-adopt.config'
import type { EmailSender, Plugin, PluginScreen, PluginWidget } from './define'
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

/**
 * One registered plugin, for the admin's plugin list and its page. Every plugin has a page at
 * `href`: its own home screen (`path: ''`) when it declares one, otherwise a built-in overview
 * (`hasOwnHome: false`), which is admin-only because it shows how the plugin is set up.
 */
export type PluginInfo = {
  name: string
  title: string
  description: string | null
  href: string
  hasOwnHome: boolean
  /** Its menu-visible screens (no parameters, not hidden). */
  screens: Array<{ title: string; href: string; adminOnly: boolean }>
  widgets: string[]
  /** It sends the site's email. */
  email: boolean
}

type Registry = {
  plugins: Plugin[]
  infos: PluginInfo[]
  screens: ResolvedScreen[]
  widgets: ResolvedWidget[]
  email: { plugin: string; sender: EmailSender } | null
}

/** "resend-email" -> "Resend email". */
const humanise = (name: string) => name.replace(/-/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
const MAIL_ICON = toNavIcon(FiMail)

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
  const infos: PluginInfo[] = []
  let email: Registry['email'] = null

  for (const plugin of plugins) {
    const who = `Plugin "${plugin.name}"`
    if (!NAME.test(plugin.name)) {
      throw new Error(`Plugin name "${plugin.name}" must be lowercase letters, digits and dashes.`)
    }
    if (seenNames.has(plugin.name)) {
      throw new Error(`${who} is registered twice. Names must be unique.`)
    }
    seenNames.add(plugin.name)

    if (plugin.email !== undefined) {
      if (typeof plugin.email?.send !== 'function') throw new Error(`${who}: email.send must be a function.`)
      if (plugin.email.status !== undefined && typeof plugin.email.status !== 'function') {
        throw new Error(`${who}: email.status must be a function.`)
      }
      // Two senders would leave it unclear which one a reset link goes out through.
      if (email) throw new Error(`${who} provides email, but "${email.plugin}" already does. Register only one.`)
      email = { plugin: plugin.name, sender: plugin.email }
    }
    if (plugin.title !== undefined && (typeof plugin.title !== 'string' || !plugin.title.trim())) {
      throw new Error(`${who}: title must be a non-empty string.`)
    }

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

    const own = screens.filter((screen) => screen.plugin === plugin.name)
    infos.push({
      name: plugin.name,
      title: plugin.title?.trim() || humanise(plugin.name),
      description: plugin.description?.trim() || null,
      href: [PLUGIN_BASE, plugin.name].join('/'),
      hasOwnHome: own.some((screen) => screen.segments.length === 0),
      screens: own
        .filter((screen) => !screen.hidden && !screen.segments.some((segment) => segment.startsWith(':')))
        .map((screen) => ({ title: screen.title, href: screen.href, adminOnly: Boolean(screen.adminOnly) })),
      widgets: (plugin.dashboardWidgets ?? []).map((widget) => widget.title),
      email: email?.plugin === plugin.name,
    })
  }

  return { plugins, infos, screens, widgets, email }
}

let cached: Registry | undefined
function registry(): Registry {
  return (cached ??= build())
}

/**
 * Menu entries, plugin by plugin: its overview page first when it has no home screen of its own
 * (admin-only, the mail icon for an email plugin), then every screen that has no parameters and is
 * not hidden. So each plugin always has at least one entry.
 */
export function getPluginNav(): AdminNavItem[] {
  const { infos, screens } = registry()
  return infos.flatMap((info) => {
    const overview: AdminNavItem[] = info.hasOwnHome ? [] : [{ href: info.href, label: info.title, adminOnly: true, icon: info.email ? MAIL_ICON : undefined }]
    const own = screens
      .filter((s) => s.plugin === info.name && !s.hidden && !s.segments.some((seg) => seg.startsWith(':')))
      .map((s) => ({ href: s.href, label: s.nav?.label ?? s.title, adminOnly: s.adminOnly, icon: s.navIcon }))
    return [...overview, ...own]
  })
}

/** Every registered plugin, in the order they load. */
export function getPluginInfos(): PluginInfo[] {
  return registry().infos
}

export function getPluginInfo(name: string): PluginInfo | null {
  return registry().infos.find((info) => info.name === name) ?? null
}

/**
 * The email sender, or null when no plugin provides one or it reports that it is not set up yet:
 * the site then does not offer email (password reset links), rather than offer it and fail.
 */
export function getEmailSender(): EmailSender | null {
  const email = registry().email
  if (!email) return null
  return email.sender.status && !email.sender.status().ready ? null : email.sender
}

/** The plugin that sends email and its sender, set up or not (its admin page shows the status). */
export function getEmailPlugin(): { plugin: string; sender: EmailSender } | null {
  return registry().email
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
