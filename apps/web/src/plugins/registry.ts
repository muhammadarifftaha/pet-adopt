import { FiMail } from 'react-icons/fi'

import type { AdminNavItem, NavIcon } from '@/components/admin/nav-items'

import config from '../../pet-adopt.config'
import siteBlocks from '../../pet-adopt.blocks'
import { accessOf, accessPermission, type EmailSender, type EmailTemplateUse, type AnyPluginBlock, type Plugin, type PluginBlockLoader, type PluginEmailTemplate, type PluginAccess, type PluginMigration, type PluginScreen, type PluginStorage, type PluginWidget } from '@pet-adopt/plugin-sdk'
import { IconError, toNavIcon } from './icon'
import { storageProblems } from './storage-rules'
import { logError } from '@/server/result'
// Register what plugins reach through the SDK: `storage.open()` and `host()`.
import './host'
import './storage'

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
  screens: Array<{ title: string; href: string; access: PluginAccess }>
  widgets: string[]
  /** It sends the site's email. */
  email: boolean
  /** It has tables of its own (see `getPluginStorageStatus` for whether they are set up). */
  storage: boolean
}

type Registry = {
  plugins: Plugin[]
  infos: PluginInfo[]
  screens: ResolvedScreen[]
  widgets: ResolvedWidget[]
  email: { plugin: string; sender: EmailSender } | null
  templateUsage: Array<{ plugin: string; usage: () => Promise<EmailTemplateUse[]> }>
  /** Plugin default templates, keyed `<plugin>:<key>`. */
  templateSeeds: Array<PluginEmailTemplate & { seedKey: string; plugin: string }>
  /** The server half of plugin blocks, by block name. */
  blockLoaders: Map<string, { plugin: string; load: PluginBlockLoader }>
}

/** "resend-email" -> "Resend email". */
const humanise = (name: string) => name.replace(/-/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
const MAIL_ICON = toNavIcon(FiMail)

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const LITERAL_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const PARAM_SEGMENT = /^:[a-zA-Z][a-zA-Z0-9]*$/
/** A page builder block's name, as saved in pages (the same pattern as src/puck/plugin-blocks.tsx). */
const BLOCK_NAME = /^[A-Z][A-Za-z0-9]{0,59}$/

export const PLUGIN_BASE = '/admin/plugins'

function flatten(list: Plugin[], out: Plugin[] = []): Plugin[] {
  for (const plugin of list) {
    flatten(plugin.plugins ?? [], out)
    out.push(plugin)
  }
  return out
}

/**
 * The loaders of every plugin's page builder blocks, checked against the site's list of blocks
 * (pet-adopt.blocks.ts). A loader's name must be a block name and belong to one plugin; a listed
 * block must name a configured plugin, and its loader (it may have none) must be that plugin's.
 * A loader whose block the site does not list is fine: it is simply never asked.
 */
export function collectBlockLoaders(plugins: Plugin[], blocks: readonly AnyPluginBlock[]): Registry['blockLoaders'] {
  const loaders: Registry['blockLoaders'] = new Map()
  for (const plugin of plugins) {
    if (plugin.blockLoaders === undefined) continue
    const who = `Plugin "${plugin.name}"`
    if (typeof plugin.blockLoaders !== 'object' || plugin.blockLoaders === null || Array.isArray(plugin.blockLoaders)) {
      throw new Error(`${who}: blockLoaders must be an object of functions, keyed by block name.`)
    }
    for (const [name, load] of Object.entries(plugin.blockLoaders)) {
      if (!BLOCK_NAME.test(name)) throw new Error(`${who}: the block name "${name}" must be letters and digits starting with a capital, such as "AcmeGallery".`)
      if (typeof load !== 'function') throw new Error(`${who}: the loader of the block "${name}" must be a function.`)
      const other = loaders.get(name)
      if (other) throw new Error(`${who} has a loader for the block "${name}", but "${other.plugin}" already does. Block names must be unique.`)
      loaders.set(name, { plugin: plugin.name, load })
    }
  }
  for (const block of blocks) {
    const who = `pet-adopt.blocks.ts: the block "${block.name}"`
    if (!plugins.some((plugin) => plugin.name === block.plugin)) {
      throw new Error(`${who} belongs to the plugin "${block.plugin}", which is not in pet-adopt.config.ts. Add the plugin there too.`)
    }
    const loader = loaders.get(block.name)
    if (loader && loader.plugin !== block.plugin) {
      throw new Error(`${who} says it belongs to "${block.plugin}", but its loader comes from "${loader.plugin}".`)
    }
  }
  return loaders
}

function build(): Registry {
  const plugins = flatten(config.plugins ?? [])
  const seenNames = new Set<string>()
  const screens: ResolvedScreen[] = []
  const widgets: ResolvedWidget[] = []
  const infos: PluginInfo[] = []
  let email: Registry['email'] = null
  const templateUsage: Registry['templateUsage'] = []
  const templateSeeds: Registry['templateSeeds'] = []

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
    if (plugin.emailTemplateUsage !== undefined) {
      if (typeof plugin.emailTemplateUsage !== 'function') throw new Error(`${who}: emailTemplateUsage must be a function.`)
      templateUsage.push({ plugin: plugin.name, usage: plugin.emailTemplateUsage })
    }
    if (plugin.emailTemplates !== undefined) {
      if (!Array.isArray(plugin.emailTemplates)) throw new Error(`${who}: emailTemplates must be a list.`)
      for (const seed of plugin.emailTemplates) {
        if (!/^[a-z0-9-]{1,40}$/.test(seed?.key ?? '')) throw new Error(`${who}: an email template key must be lowercase letters, digits and dashes.`)
        if (typeof seed.name !== 'string' || !seed.name.trim() || seed.name.length > 80) throw new Error(`${who}: email template "${seed.key}" needs a name of at most 80 characters.`)
        if (seed.purpose !== 'team-notification' && seed.purpose !== 'visitor-message') throw new Error(`${who}: email template "${seed.key}" must be a team-notification or a visitor-message.`)
        const seedKey = `${plugin.name}:${seed.key}`
        if (templateSeeds.some((other) => other.seedKey === seedKey)) throw new Error(`${who}: two email templates have the key "${seed.key}".`)
        templateSeeds.push({ ...seed, name: seed.name.trim(), seedKey, plugin: plugin.name })
      }
    }
    if (plugin.storage !== undefined) {
      const problems = storageProblems(plugin.name, plugin.storage)
      if (problems.length) throw new Error(`${who}: ${problems.join(' ')}`)
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
        .map((screen) => ({ title: screen.title, href: screen.href, access: accessOf(screen) })),
      widgets: (plugin.dashboardWidgets ?? []).map((widget) => widget.title),
      email: email?.plugin === plugin.name,
      storage: plugin.storage !== undefined,
    })
  }

  return { plugins, infos, screens, widgets, email, templateUsage, templateSeeds, blockLoaders: collectBlockLoaders(plugins, siteBlocks) }
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
    const overview: AdminNavItem[] = info.hasOwnHome ? [] : [{ href: info.href, label: info.title, permission: 'plugins:view', icon: info.email ? MAIL_ICON : undefined }]
    const own = screens
      .filter((s) => s.plugin === info.name && !s.hidden && !s.segments.some((seg) => seg.startsWith(':')))
      .map((s) => ({ href: s.href, label: s.nav?.label ?? s.title, permission: accessPermission(accessOf(s), 'view'), icon: s.navIcon }))
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
 * The plugin that sends email and its sender, set up or not (its admin page shows the status). The
 * site's sender (a ready plugin, else built-in SMTP) is `getEmailSender` in src/server/email.ts.
 */
export function getEmailPlugin(): { plugin: string; sender: EmailSender } | null {
  return registry().email
}

/**
 * Where each email template is used, from every plugin that reports it (`emailTemplateUsage`), keyed
 * by template id. A plugin that fails (not migrated yet, say) is skipped.
 */
export async function getEmailTemplateUsage(): Promise<Map<number | string, Array<{ label: string; href?: string }>>> {
  // Keyed by template id, or by seed key (`<plugin>:<key>`) for uses of a plugin's default.
  const byTemplate = new Map<number | string, Array<{ label: string; href?: string }>>()
  for (const { plugin, usage } of registry().templateUsage) {
    try {
      for (const use of await usage()) {
        const key = Number.isSafeInteger(use?.templateId) ? (use.templateId as number) : typeof use?.seedKey === 'string' ? use.seedKey : null
        if (key === null || typeof use.label !== 'string') continue
        const href = typeof use.href === 'string' && use.href.startsWith('/admin/') ? use.href : undefined
        byTemplate.set(key, [...(byTemplate.get(key) ?? []), { label: use.label.slice(0, 200), href }])
      }
    } catch (error) {
      logError(error, `plugin "${plugin}" could not report where it uses email templates`)
    }
  }
  return byTemplate
}

/** Every plugin's default email templates (`seedKey` is `<plugin>:<key>`). */
export function getPluginEmailTemplates(): Registry['templateSeeds'] {
  return registry().templateSeeds
}

/**
 * The server half of a plugin's page builder block: `load` is its loader, or null when the block
 * shows nothing loaded. Undefined when the site lists no block of that name (pet-adopt.blocks.ts).
 */
export function getPluginBlock(name: string): { plugin: string; load: PluginBlockLoader | null } | undefined {
  const block = siteBlocks.find((entry) => entry.name === name)
  if (!block) return undefined
  return { plugin: block.plugin, load: registry().blockLoaders.get(name)?.load ?? null }
}

export function getPluginWidgets(): ResolvedWidget[] {
  return registry().widgets
}

/** The name of the registered plugin whose `storage` is this object, or null. */
export function getPluginByStorage(storage: PluginStorage): string | null {
  return registry().plugins.find((plugin) => plugin.storage === storage)?.name ?? null
}

/** Each plugin that has tables of its own, with its migrations, in load order. */
export function getPluginMigrationSets(): Array<{ plugin: string; title: string; migrations: PluginMigration[] }> {
  const { plugins, infos } = registry()
  return plugins.flatMap((plugin) =>
    plugin.storage
      ? [{ plugin: plugin.name, title: infos.find((i) => i.name === plugin.name)!.title, migrations: [...plugin.storage.migrations] }]
      : [],
  )
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
