import { PRESETS, resolveTheme, type PresetKey, type ThemeSettings } from '@/lib/theme'

// Shared by the theme library and editor. Pure: the same resolveTheme the site uses, so swatches
// and previews show exactly the colours visitors get.

export type CustomTheme = NonNullable<ThemeSettings['customTheme']>
export type ColorKey = 'primary' | 'background' | 'surface' | 'text' | 'tint'

export const COLOR_FIELDS: Array<{ key: ColorKey; label: string; hint: string; token: string }> = [
  { key: 'primary', label: 'Brand colour', hint: 'Buttons, links and highlights.', token: '--primary' },
  { key: 'background', label: 'Page background', hint: 'Behind everything.', token: '--bg' },
  { key: 'surface', label: 'Cards and panels', hint: 'Pet cards, tables, boxes.', token: '--surface' },
  { key: 'text', label: 'Text', hint: 'Must be easy to read on the background and on cards.', token: '--ink' },
  { key: 'tint', label: 'Tinted sections', hint: 'Soft background for highlighted sections.', token: '--tint' },
]

/** The settings resolveTheme reads, for a base preset with customisations on top. */
export function themeInput(base: string, settings: CustomTheme | null | undefined): ThemeSettings {
  return { theme: base, customize: true, customTheme: settings ?? {}, allowModeToggle: true }
}

export const resolved = (base: string, settings?: CustomTheme | null) => resolveTheme(themeInput(base, settings))

export const presetLabel = (key: string) => (key in PRESETS ? PRESETS[key as PresetKey].label : key)

/** "Name copy", "Name copy 2"... a name no theme has yet (compared without case). */
export function uniqueName(wanted: string, taken: string[]): string {
  const lower = new Set(taken.map((name) => name.toLowerCase()))
  if (!lower.has(wanted.toLowerCase())) return wanted
  for (let n = 2; n < 100; n++) if (!lower.has(`${wanted} ${n}`.toLowerCase())) return `${wanted} ${n}`
  return `${wanted} ${Date.now()}`
}
