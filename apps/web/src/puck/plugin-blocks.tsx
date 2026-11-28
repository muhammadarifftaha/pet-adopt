// Page builder blocks that plugins add (`definePluginBlock` in @pet-adopt/plugin-sdk, listed in
// apps/web/pet-adopt.blocks.ts). Each one is turned into a Puck block here: its options become
// fields, what its loader returns arrives in one render-only prop (`pluginData`, never saved), and
// its `render` is called with checked options.
//
// Shared by the editor (browser) and the public site (server), like every block: no hooks, no
// server-only imports. The loader itself is reached through Puck's metadata
// (`fetchPluginBlock`: src/puck/plugin-block-data.ts on the site, a server action in the editor).
import React from 'react'
import type { ComponentConfig, Config } from '@puckeditor/core'
import type { AnyPluginBlock, PluginBlockField } from '@pet-adopt/plugin-sdk'

import { PluginChoiceField } from './plugin-choice-field'
import type { PuckSiteMetadata } from './types'

type Json = Record<string, unknown>

/** A block's type in saved pages: letters and digits, starting with a capital (at most 60, see isPuckData). */
export const PLUGIN_BLOCK_NAME = /^[A-Z][A-Za-z0-9]{0,59}$/

/** The render-only prop that holds what a block's loader returned (in TRANSIENT_PROPS). */
export const PLUGIN_DATA_PROP = 'pluginData'

/** Names the page builder or this file uses on every block, so an option cannot have them. */
const RESERVED_OPTIONS = new Set(['id', 'puck', 'editMode', 'padding', 'spacing', 'headingLevel', 'data', 'editing', PLUGIN_DATA_PROP])

const FIELD_TYPES = new Set(['text', 'textarea', 'number', 'select', 'radio', 'choice'])

/** A saved `choice` value (an id): text up to this length, or a finite number. */
/** The longest text a `choice` option may save (the SDK documents it). */
export const MAX_CHOICE_LENGTH = 200

/** What a `choice` option may hold: an id as text or a number. Anything else (an object) is refused. */
export const isChoiceValue = (value: unknown): value is string | number =>
  (typeof value === 'string' && value.length <= MAX_CHOICE_LENGTH) || (typeof value === 'number' && Number.isFinite(value))
const isPlain = (value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value)
const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** What is wrong with a site's list of plugin blocks, as sentences; empty when it is fine. */
export function pluginBlockProblems(blocks: readonly AnyPluginBlock[], builtIn: readonly string[]): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  if (!Array.isArray(blocks)) return ['pet-adopt.blocks.ts must export a list of blocks (defineBlocks([...])).']
  for (const block of blocks) {
    const name = typeof block?.name === 'string' ? block.name : ''
    const who = `Plugin block "${name}"`
    if (!PLUGIN_BLOCK_NAME.test(name)) {
      problems.push(`A plugin block's name must be letters and digits starting with a capital, such as "AcmeGallery" (got ${JSON.stringify(block?.name)}).`)
      continue
    }
    if (builtIn.includes(name)) problems.push(`${who} has the name of a built-in block. Names must be unique.`)
    if (seen.has(name)) problems.push(`${who} is listed twice. Names must be unique.`)
    seen.add(name)
    if (typeof block.label !== 'string' || !block.label.trim()) problems.push(`${who} needs a label.`)
    if (typeof block.plugin !== 'string' || !block.plugin) problems.push(`${who} must name its plugin.`)
    if (typeof block.render !== 'function') problems.push(`${who} needs a render function.`)
    if (block.css !== undefined && typeof block.css !== 'string') problems.push(`${who}: css must be text.`)
    if (!isObject(block.fields)) problems.push(`${who} needs a fields object (it may be empty).`)
    if (!isObject(block.defaultProps)) problems.push(`${who} needs defaultProps (it may be empty).`)
    if (!isObject(block.fields) || !isObject(block.defaultProps)) continue
    for (const key of new Set([...Object.keys(block.fields), ...Object.keys(block.defaultProps)])) {
      if (RESERVED_OPTIONS.has(key)) problems.push(`${who}: an option cannot be named "${key}".`)
    }
    for (const flag of ['needsData', 'headingFromData', 'petPage'] as const) {
      if (block[flag] !== undefined && typeof block[flag] !== 'boolean') problems.push(`${who}: ${flag} must be true or false.`)
    }
    if (block.dataOptions !== undefined) {
      const known = new Set([...Object.keys(block.fields), ...Object.keys(block.defaultProps)])
      if (!Array.isArray(block.dataOptions) || !(block.dataOptions as unknown[]).every((key) => typeof key === 'string' && known.has(key))) {
        problems.push(`${who}: dataOptions must be a list of the block's own option names.`)
      }
    }
    for (const [key, value] of Object.entries(block.defaultProps)) {
      if (!isPlain(value)) problems.push(`${who}: the default of "${key}" must be text, a number, true, false or null.`)
    }
    for (const [key, field] of Object.entries(block.fields as Record<string, PluginBlockField | undefined>)) {
      if (!field) continue
      if (!FIELD_TYPES.has(field.type)) problems.push(`${who}: option "${key}" has an unknown type "${String(field.type)}".`)
      else if (typeof field.label !== 'string' || !field.label.trim()) problems.push(`${who}: option "${key}" needs a label.`)
      else if ((field.type === 'select' || field.type === 'radio') && !(Array.isArray(field.options) && field.options.length > 0 && field.options.every((o) => typeof o?.label === 'string' && isPlain(o.value) && o.value !== null))) {
        problems.push(`${who}: option "${key}" needs a list of choices ({ label, value }).`)
      } else if (field.type === 'choice' && typeof field.load !== 'function') {
        problems.push(`${who}: option "${key}" needs a load function (a server action that lists the choices).`)
      } else if (field.type === 'choice' && field.empty !== undefined && typeof field.empty !== 'string') {
        problems.push(`${who}: option "${key}": empty must be text.`)
      }
    }
  }
  return problems
}

/**
 * A block's own options out of what a page (or a browser) holds for it, each one checked: a missing
 * value or one of the wrong kind becomes the default, a number is kept inside its limits, and a
 * choice must be one the option offers. Nothing else is passed on, so a block's `render` and its
 * loader only ever see options of the kinds the block declared.
 */
export function pluginBlockOptions(block: AnyPluginBlock, props: Json): Json {
  const fields = block.fields as Record<string, PluginBlockField | undefined>
  const defaults = block.defaultProps as Json
  const out: Json = {}
  for (const key of new Set([...Object.keys(defaults), ...Object.keys(fields)])) {
    const field = fields[key]
    const fallback = defaults[key]
    const value = Object.prototype.hasOwnProperty.call(props, key) ? props[key] : undefined
    let checked: unknown
    if (!field) {
      // An option the sidebar does not show: kept only when it is the same kind as its default.
      checked = isPlain(value) && value !== null && typeof value === typeof fallback ? value : undefined
    } else if (field.type === 'text' || field.type === 'textarea') {
      checked = typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined
    } else if (field.type === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        checked = Math.min(Math.max(value, field.min ?? -Infinity), field.max ?? Infinity)
      }
    } else if (field.type === 'select' || field.type === 'radio') {
      checked = field.options.some((option) => option.value === value) ? value : undefined
    } else if (field.type === 'choice') {
      // An id from the plugin's own list. Whether it still exists is the loader's business.
      checked = isChoiceValue(value) ? value : undefined
    }
    out[key] = checked === undefined ? fallback : checked
  }
  return out
}

function toPuckField(block: AnyPluginBlock, key: string, field: PluginBlockField) {
  switch (field.type) {
    case 'choice': {
      const { label, load, empty } = field
      return {
        type: 'custom',
        label,
        // Read by sanitizeLayout: the saved value is an id (text or a number), never an object.
        plainValue: true,
        render: ({ id, value, onChange, readOnly }: { id: string; value: unknown; onChange: (value: string | number | null) => void; readOnly?: boolean }) => (
          <PluginChoiceField id={id} label={label} cacheKey={`plugin-choice:${block.name}:${key}`} load={load} empty={empty} value={value} onChange={onChange} readOnly={readOnly} />
        ),
      }
    }
    case 'text':
    case 'textarea':
      return { type: field.type, label: field.label }
    case 'number':
      return { type: 'number', label: field.label, ...(field.min !== undefined ? { min: field.min } : {}), ...(field.max !== undefined ? { max: field.max } : {}), ...(field.step !== undefined ? { step: field.step } : {}) }
    case 'select':
    case 'radio':
      return { type: field.type, label: field.label, options: field.options.map((option) => ({ label: option.label, value: option.value })) }
  }
}

type RenderProps = Json & { puck?: { isEditing?: boolean } }

/** One plugin block as a Puck block. */
/** Loaded data is an object or a list; anything else (a value saved into a page by hand) counts as none. */
const isLoaded = (value: unknown) => typeof value === 'object' && value !== null

export function toPuckComponent(block: AnyPluginBlock): ComponentConfig {
  const fields = Object.fromEntries(
    Object.entries(block.fields as Record<string, PluginBlockField | undefined>).flatMap(([key, field]) => (field ? [[key, toPuckField(block, key, field)]] : [])),
  )
  const component = {
    label: block.label,
    defaultProps: { ...(block.defaultProps as Json) },
    fields,
    // What the block shows comes from its plugin's loader, on the site and in the editor alike. A
    // loader that fails, or a site with no way to ask, gives null: the block decides what that looks like.
    //
    // In the editor Puck calls this after every change to the block, a keystroke in a text option
    // included. A block that names the options its loader reads (`dataOptions`) keeps what was
    // loaded while those stay the same (`lastData` is the block as it was resolved last; the
    // loaded data is still in `props`, where the last run put it). A forced run always loads, and
    // so does a block with nothing loaded yet, so a failed load is tried again on the next change.
    resolveData: async ({ props }: { props: Json }, { metadata, lastData, trigger }: { metadata?: unknown; lastData?: { props?: Json } | null; trigger?: string } = {}) => {
      const load = (metadata as Partial<PuckSiteMetadata> | undefined)?.fetchPluginBlock
      const options = pluginBlockOptions(block, props)
      const reads = block.dataOptions as readonly string[] | undefined
      if (load && Array.isArray(reads) && trigger !== 'force' && isObject(lastData?.props) && props[PLUGIN_DATA_PROP] != null) {
        const before = pluginBlockOptions(block, lastData.props)
        if (reads.every((key) => Object.is(before[key], options[key]))) return { props }
      }
      let data: unknown = null
      if (load) {
        try {
          data = (await load(block.name, options)) ?? null
        } catch {
          data = null
        }
      }
      return { props: { ...props, [PLUGIN_DATA_PROP]: data } }
    },
    render: (props: RenderProps) => {
      const editing = Boolean(props.puck?.isEditing)
      const headingLevel = props.headingLevel === 1 || props.headingLevel === 2 ? props.headingLevel : undefined
      let drawn: React.ReactElement | null
      try {
        drawn = block.render({ ...pluginBlockOptions(block, props), data: isLoaded(props[PLUGIN_DATA_PROP]) ? props[PLUGIN_DATA_PROP] : null, editing, headingLevel })
      } catch (error) {
        // One block must not take the page down with it. (This catches the block's own function;
        // a component it returns is drawn later by React and is not covered.)
        console.error(`Plugin block "${block.name}" could not be drawn: ${error instanceof Error ? error.message : String(error)}`)
        drawn = editing ? (
          <div className="container">
            <p className="muted">The {block.label} block could not be drawn, so it is hidden on the site.</p>
          </div>
        ) : null
      }
      // Nothing drawn, nothing to style: a block that is hidden on the site adds no CSS to the page.
      if (drawn === null || drawn === undefined) return <></>
      return (
        <>
          {block.css ? <style>{block.css}</style> : null}
          {drawn}
        </>
      )
    },
  }
  return component as unknown as ComponentConfig
}

/**
 * `config` with the site's plugin blocks added, under a "Plugins" category that only exists when
 * there is at least one. The Pet page template passes only the blocks that set `petPage`. Throws when the list is wrong (a bad name, a clash with a built-in block),
 * so a mistake shows when the site starts, not when a page is drawn.
 */
export function withPluginBlocks<C extends Config>(config: C, blocks: readonly AnyPluginBlock[]): C {
  const problems = pluginBlockProblems(blocks, Object.keys(config.components))
  if (problems.length) throw new Error(`pet-adopt.blocks.ts: ${problems.join(' ')}`)
  if (blocks.length === 0) return config
  return {
    ...config,
    categories: { ...(config.categories ?? {}), plugins: { title: 'Plugins', components: blocks.map((block) => block.name) } },
    components: { ...config.components, ...Object.fromEntries(blocks.map((block) => [block.name, toPuckComponent(block)])) },
  } as C
}
