// What a plugin's page builder block shows: its loader (`Plugin.blockLoaders[name]`), run for the
// public site and for the editor's preview. Server-only. A plugin block never breaks a page: an
// unknown block, a block with no loader, a plugin whose tables are not set up yet, a loader that
// throws and a result that is not plain JSON all give null, and the block then decides what to show.
import type { PluginBlockLoader } from '@pet-adopt/plugin-sdk'

import { logError } from '@/server/result'
// Register what plugins reach through the SDK (a no-op if the server start already did).
import '@/plugins/host'
import '@/plugins/storage'
import { getPluginBlock } from '@/plugins/registry'
import { PluginNotReadyError } from '@/plugins/storage'

/** A block's result is a feed or a short list. Anything near this size is a mistake. */
const MAX_RESULT_BYTES = 1_000_000
/** The options of one block, as the editor sends them: a handful of short values. */
const MAX_PROPS_BYTES = 20_000

const quiet = () => process.env.NEXT_PHASE === 'phase-production-build'

/**
 * A block's options as they may be handed to a loader: one flat object of plain values (text,
 * numbers, true, false, null), or null when `props` is anything else or too large. The loader still
 * treats them as untrusted: this only bounds what it can be sent.
 */
export function plainBlockProps(props: unknown): Record<string, unknown> | null {
  if (typeof props !== 'object' || props === null || Array.isArray(props)) return null
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) out[key] = value
  }
  try {
    return JSON.stringify(out).length <= MAX_PROPS_BYTES ? out : null
  } catch {
    return null
  }
}

/** Runs one loader. Never throws: a failure is logged (without the error object) and gives null. */
export async function runPluginBlockLoader(name: string, load: PluginBlockLoader, options: Record<string, unknown>): Promise<unknown> {
  try {
    const result = await load(options)
    if (result === undefined || result === null) return null
    // Plain JSON only: it crosses to the browser in the editor, and the site should draw the same.
    const json = JSON.stringify(result)
    if (json === undefined) return null
    if (json.length > MAX_RESULT_BYTES) {
      if (!quiet()) logError(new Error(`the result is too large (${json.length} bytes)`), `Plugin block "${name}"`)
      return null
    }
    return JSON.parse(json) as unknown
  } catch (error) {
    // A plugin whose tables are not migrated yet is reported at server start and on its screens.
    if (!(error instanceof PluginNotReadyError) && !quiet()) logError(error, `Plugin block "${name}"`)
    return null
  }
}

export async function fetchPluginBlockData(name: unknown, props: unknown): Promise<unknown> {
  if (typeof name !== 'string') return null
  const options = plainBlockProps(props)
  if (!options) return null
  const block = getPluginBlock(name)
  return block?.load ? runPluginBlockLoader(name, block.load, options) : null
}
