// Names that both halves of the plugin use: the server half (src/index.tsx, src/server.ts) and the
// page builder block (src/block.tsx), which the browser loads. Plain constants, so the block can
// import them without pulling in the plugin's tables.

/** The plugin's name (`Plugin.name`): its addresses, table prefix and activity log entries. */
export const FORM_BUILDER = 'form-builder'

/**
 * The Form block's type in saved pages. It was a built-in block of the site under this name before
 * it moved into the plugin, so saved pages keep it: never change it.
 */
export const FORM_BLOCK = 'FormBlock'
