/**
 * The theming system: presets, colour maths and the CSS that applies a theme.
 *
 * Everything an admin can choose ends up as CSS custom properties on <html> (see themeCss).
 * The stylesheet in src/app/(frontend)/styles.css only ever reads those variables, so adding or
 * changing a preset never touches component code.
 *
 * Pure TypeScript with no React or Payload imports, so the admin (field options and validation)
 * and the pages share it.
 */

// ---------------------------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------------------------

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

export const isHex = (value: unknown): value is string => typeof value === 'string' && HEX.test(value.trim())

type RGB = [number, number, number]

function parse(hex: string): RGB {
  let h = hex.trim().slice(1)
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB
}

function toHex(rgb: RGB): string {
  return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
}

/** Blend two colours. `t` is the share of `b` (0 gives `a`, 1 gives `b`). */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parse(a)
  const [br, bg, bb] = parse(b)
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t])
}

function luminance(hex: string): number {
  const [r, g, b] = parse(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Nudge `fg` towards black or white (whichever helps) until it reaches `min` contrast on `bg`. */
export function ensureContrast(fg: string, bg: string, min: number): string {
  if (contrast(fg, bg) >= min) return fg
  const toward = luminance(bg) > 0.5 ? '#000000' : '#ffffff'
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const candidate = mix(fg, toward, t)
    if (contrast(candidate, bg) >= min) return candidate
  }
  return toward
}

/** White or near-black, whichever reads better on `bg`. */
const readableOn = (bg: string) => (contrast('#ffffff', bg) >= contrast('#111111', bg) ? '#ffffff' : '#111111')

// ---------------------------------------------------------------------------------------------
// Building blocks an admin can choose from
// ---------------------------------------------------------------------------------------------

// Font families come from the @fontsource-variable packages imported in src/app/(frontend)/fonts.ts.
export const FONTS = {
  system: { label: 'System default', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  inter: { label: 'Inter (clean sans)', stack: "'Inter Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  nunito: { label: 'Nunito (soft, rounded)', stack: "'Nunito Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  'dm-sans': { label: 'DM Sans (geometric)', stack: "'DM Sans Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  lora: { label: 'Lora (serif)', stack: "'Lora Variable', Georgia, 'Times New Roman', serif" },
  'playfair-display': { label: 'Playfair Display (elegant serif)', stack: "'Playfair Display Variable', Georgia, 'Times New Roman', serif" },
} as const
export type FontKey = keyof typeof FONTS

export const RADII = {
  none: { label: 'Square', px: 0 },
  sm: { label: 'Slightly rounded', px: 6 },
  md: { label: 'Rounded', px: 12 },
  lg: { label: 'Very rounded', px: 18 },
  xl: { label: 'Extra rounded', px: 26 },
} as const
export type RadiusKey = keyof typeof RADII

export const BUTTONS = {
  pill: { label: 'Pill' },
  rounded: { label: 'Rounded corners' },
  square: { label: 'Square' },
} as const
export type ButtonKey = keyof typeof BUTTONS

// Dark mode multiplies the shadow alpha (see darken) so shadows still show on dark surfaces.
export const SHADOWS = {
  none: { label: 'None (flat)', card: 'none', hover: 'none' },
  lift: { label: 'Lift on hover', card: 'none', hover: '0 8px 24px rgba(0, 0, 0, 0.1)' },
  soft: { label: 'Soft', card: '0 1px 2px rgba(0, 0, 0, 0.05), 0 4px 14px rgba(0, 0, 0, 0.06)', hover: '0 8px 24px rgba(0, 0, 0, 0.12)' },
  medium: { label: 'Medium', card: '0 2px 6px rgba(0, 0, 0, 0.12)', hover: '0 10px 28px rgba(0, 0, 0, 0.2)' },
  hard: { label: 'Hard offset', card: '4px 4px 0 var(--ink)', hover: '6px 6px 0 var(--ink)' },
} as const
export type ShadowKey = keyof typeof SHADOWS

export const DENSITIES = {
  compact: { label: 'Compact', scale: 0.8 },
  comfortable: { label: 'Comfortable', scale: 1 },
  spacious: { label: 'Spacious', scale: 1.25 },
} as const
export type DensityKey = keyof typeof DENSITIES

export const TEXT_SIZES = {
  small: { label: 'Small (15px)', px: 15 },
  medium: { label: 'Medium (16px)', px: 16 },
  large: { label: 'Large (18px)', px: 18 },
} as const
export type TextSizeKey = keyof typeof TEXT_SIZES

const options = <T extends Record<string, { label: string }>>(map: T) =>
  (Object.keys(map) as Array<keyof T & string>).map((value) => ({ label: map[value].label, value }))

export const FONT_OPTIONS = options(FONTS)
export const RADIUS_OPTIONS = options(RADII)
export const BUTTON_OPTIONS = options(BUTTONS)
export const SHADOW_OPTIONS = options(SHADOWS)
export const DENSITY_OPTIONS = options(DENSITIES)
export const TEXT_SIZE_OPTIONS = options(TEXT_SIZES)

// ---------------------------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------------------------

/** The four base colours a theme is built from. Everything else is derived. */
export type Palette = { primary: string; bg: string; surface: string; ink: string; tint?: string }

export type Preset = {
  label: string
  description: string
  light: Palette
  dark: Palette
  headingFont: FontKey
  bodyFont: FontKey
  headingWeight: number
  radius: RadiusKey
  button: ButtonKey
  shadow: ShadowKey
  density: DensityKey
  textSize: TextSizeKey
}

export const DEFAULT_PRESET = 'sunrise'

export const PRESETS = {
  sunrise: {
    label: 'Sunrise',
    description: 'Warm orange, friendly and familiar. The original look.',
    light: { primary: '#e8590c', bg: '#ffffff', surface: '#ffffff', ink: '#1f2937', tint: '#fff7f0' },
    dark: { primary: '#fb923c', bg: '#14171c', surface: '#1d2128', ink: '#f3f4f6' },
    headingFont: 'system', bodyFont: 'system', headingWeight: 700,
    radius: 'md', button: 'pill', shadow: 'lift', density: 'comfortable', textSize: 'medium',
  },
  meadow: {
    label: 'Meadow',
    description: 'Fresh green with soft, rounded shapes and gentle shadows.',
    light: { primary: '#2f855a', bg: '#fbfdf9', surface: '#ffffff', ink: '#1f2d24' },
    dark: { primary: '#5fd08f', bg: '#0f1713', surface: '#17221b', ink: '#e8f3ec' },
    headingFont: 'nunito', bodyFont: 'nunito', headingWeight: 800,
    radius: 'xl', button: 'pill', shadow: 'soft', density: 'comfortable', textSize: 'medium',
  },
  ocean: {
    label: 'Ocean',
    description: 'Calm blue, crisp and modern, with tighter corners.',
    light: { primary: '#0b6bcb', bg: '#f7fafd', surface: '#ffffff', ink: '#0f2236' },
    dark: { primary: '#5aa9ff', bg: '#0b1522', surface: '#12202f', ink: '#e6eef7' },
    headingFont: 'dm-sans', bodyFont: 'dm-sans', headingWeight: 700,
    radius: 'sm', button: 'rounded', shadow: 'medium', density: 'comfortable', textSize: 'medium',
  },
  heritage: {
    label: 'Heritage',
    description: 'Deep red with serif headings, square corners and generous space.',
    light: { primary: '#9b2c2c', bg: '#fffdf9', surface: '#ffffff', ink: '#2b2118', tint: '#fbf3ea' },
    dark: { primary: '#e48e8e', bg: '#17120e', surface: '#221b15', ink: '#f1e9df' },
    headingFont: 'lora', bodyFont: 'inter', headingWeight: 600,
    radius: 'none', button: 'square', shadow: 'none', density: 'spacious', textSize: 'medium',
  },
  studio: {
    label: 'Studio',
    description: 'Black and white with elegant headings and bold hard-edged shadows.',
    light: { primary: '#111111', bg: '#ffffff', surface: '#ffffff', ink: '#111111' },
    dark: { primary: '#f5f5f5', bg: '#0a0a0a', surface: '#141414', ink: '#f5f5f5' },
    headingFont: 'playfair-display', bodyFont: 'dm-sans', headingWeight: 700,
    radius: 'none', button: 'square', shadow: 'hard', density: 'comfortable', textSize: 'medium',
  },
} as const satisfies Record<string, Preset>

export type PresetKey = keyof typeof PRESETS
export const PRESET_KEYS = Object.keys(PRESETS) as PresetKey[]
export const PRESET_OPTIONS = PRESET_KEYS.map((value) => ({ label: PRESETS[value].label, value }))
export const PRESET_HELP = PRESET_KEYS.map((key) => `${PRESETS[key].label}: ${PRESETS[key].description}`).join(' ')

// ---------------------------------------------------------------------------------------------
// Settings in, resolved theme out
// ---------------------------------------------------------------------------------------------

export type ColorOverrides = {
  primary?: string | null
  background?: string | null
  surface?: string | null
  text?: string | null
  tint?: string | null
}

/** The theme-related part of the site settings. Every value is optional and untrusted. */
export type ThemeSettings = {
  theme?: string | null
  /** The older single "brand colour" field. It replaces the preset's primary colour. */
  primaryColor?: string | null
  allowModeToggle?: boolean | null
  customize?: boolean | null
  customTheme?: {
    headingFont?: string | null
    bodyFont?: string | null
    radius?: string | null
    button?: string | null
    shadow?: string | null
    density?: string | null
    textSize?: string | null
    light?: ColorOverrides | null
    dark?: ColorOverrides | null
  } | null
}

export type Mode = 'light' | 'dark'

/** localStorage key where a visitor's light/dark choice is remembered. */
export const MODE_STORAGE_KEY = 'pet-adopt-mode'

export type ResolvedTheme = {
  preset: PresetKey
  allowModeToggle: boolean
  /** Variables that do not change between light and dark. */
  shared: Record<string, string>
  light: Record<string, string>
  dark: Record<string, string>
}

const pick = <T extends Record<string, unknown>>(map: T, key: unknown, fallback: keyof T): keyof T =>
  typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key) ? (key as keyof T) : fallback

const hexOr = (value: unknown, fallback: string) => (isHex(value) ? value.trim().toLowerCase() : fallback)

// Shadows get stronger on dark surfaces, or they vanish.
const darken = (shadow: string) =>
  shadow.replace(/rgba\(0, 0, 0, ([\d.]+)\)/g, (_, alpha) => `rgba(0, 0, 0, ${Math.min(0.6, Number(alpha) * 2.5).toFixed(2)})`)

/** Turn a palette into every colour variable the stylesheet uses. */
/**
 * `ensureContrast` against several backgrounds at once: the colour is nudged until it reaches `min`
 * on every one of them (they are all light, or all dark, in one mode, so the nudges agree).
 */
function ensureContrastOnAll(fg: string, backgrounds: string[], min: number): string {
  let color = fg
  for (let pass = 0; pass < 2; pass++) for (const background of backgrounds) color = ensureContrast(color, background, min)
  return color
}

function colorTokens(p: Palette, mode: Mode, shadow: ShadowKey): Record<string, string> {
  const { primary, bg, surface, ink } = p
  const bandBg = mode === 'light' ? mix(ink, '#000000', 0.2) : mix(bg, '#000000', 0.45)
  const surfaceAlt = mix(ink, bg, 0.97)
  const tint = p.tint ?? mix(primary, bg, 0.92)
  // Muted text and links appear on the page, on cards, on tinted sections and on muted panels, so
  // they must reach 4.5:1 (WCAG 1.4.3) on all of them, not only on the page background.
  const textBackgrounds = [bg, surface, surfaceAlt, tint]
  return {
    '--bg': bg,
    '--surface': surface,
    '--surface-alt': surfaceAlt,
    '--placeholder': mix(ink, bg, 0.94),
    '--ink': ink,
    '--muted': ensureContrastOnAll(mix(ink, bg, 0.42), textBackgrounds, 4.5),
    '--line': mix(ink, bg, 0.9),
    '--line-strong': mix(ink, bg, 0.8),
    '--tint': tint,
    '--primary': primary,
    '--on-primary': readableOn(primary),
    // Brand colours are often too light to read as text, so links and outlined buttons use this.
    '--primary-text': ensureContrastOnAll(primary, textBackgrounds, 4.5),
    '--band-bg': bandBg,
    '--band-ink': '#f9fafb',
    '--band-link': ensureContrast(mix(primary, '#ffffff', 0.5), bandBg, 4.5),
    '--ok-bg': mode === 'light' ? '#dcfce7' : '#14351f',
    '--ok-ink': mode === 'light' ? '#166534' : '#86efac',
    '--warn-bg': mode === 'light' ? '#fef9c3' : '#3a3210',
    '--warn-ink': mode === 'light' ? '#854d0e' : '#fde68a',
    '--neutral-bg': mode === 'light' ? '#e5e7eb' : '#2a2f38',
    '--neutral-ink': mode === 'light' ? '#374151' : '#d1d5db',
    '--shadow-card': mode === 'light' ? SHADOWS[shadow].card : darken(SHADOWS[shadow].card),
    '--shadow-hover': mode === 'light' ? SHADOWS[shadow].hover : darken(SHADOWS[shadow].hover),
  }
}

/** Work out the final palette for one mode: preset, then the brand colour, then custom overrides. */
function paletteFor(mode: Mode, preset: Preset, input: ThemeSettings, custom: ColorOverrides | null | undefined): Palette {
  const base = preset[mode]
  const brand = isHex(input.primaryColor) ? input.primaryColor.trim().toLowerCase() : null
  const bg = hexOr(custom?.background, base.bg)
  // A single brand colour is used in both modes, adjusted so it stays visible on the background.
  const brandForMode = brand ? (mode === 'dark' ? ensureContrast(brand, bg, 3) : brand) : null
  // The preset's hand-picked tint only suits the preset's own colours.
  const tint = isHex(custom?.tint) ? hexOr(custom?.tint, '') : isHex(custom?.primary) || brand ? undefined : base.tint
  return {
    primary: hexOr(custom?.primary, brandForMode ?? base.primary),
    bg,
    surface: hexOr(custom?.surface, base.surface),
    ink: hexOr(custom?.text, base.ink),
    tint,
  }
}

export function resolveTheme(input: ThemeSettings = {}): ResolvedTheme {
  const presetKey = pick(PRESETS, input.theme, DEFAULT_PRESET)
  const preset: Preset = PRESETS[presetKey]
  const c = input.customize ? input.customTheme : null

  const headingFont = pick(FONTS, c?.headingFont, preset.headingFont)
  const bodyFont = pick(FONTS, c?.bodyFont, preset.bodyFont)
  const radius = RADII[pick(RADII, c?.radius, preset.radius)].px
  const radiusSm = Math.round(radius * 0.6)
  const button = pick(BUTTONS, c?.button, preset.button)
  const shadow = pick(SHADOWS, c?.shadow, preset.shadow)
  const density = DENSITIES[pick(DENSITIES, c?.density, preset.density)].scale
  const textSize = TEXT_SIZES[pick(TEXT_SIZES, c?.textSize, preset.textSize)].px

  const buttonRadius = button === 'pill' ? 999 : button === 'rounded' ? Math.max(radiusSm, 4) : 0

  return {
    preset: presetKey,
    allowModeToggle: input.allowModeToggle !== false,
    shared: {
      '--radius': `${radius}px`,
      '--radius-sm': `${radiusSm}px`,
      '--radius-btn': `${buttonRadius}px`,
      '--radius-badge': button === 'pill' ? '999px' : `${radiusSm}px`,
      '--font-body': FONTS[bodyFont].stack,
      '--font-heading': FONTS[headingFont].stack,
      '--heading-weight': String(preset.headingWeight),
      '--font-size-root': `${textSize}px`,
      '--density': String(density),
    },
    light: colorTokens(paletteFor('light', preset, input, c?.light), 'light', shadow),
    dark: colorTokens(paletteFor('dark', preset, input, c?.dark), 'dark', shadow),
  }
}

const declarations = (tokens: Record<string, string>) =>
  Object.entries(tokens)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')

/**
 * The CSS that applies a resolved theme. `html:root` outranks the fallback `:root` block in
 * styles.css whichever stylesheet loads last.
 *
 * Dark mode follows the visitor's system setting unless they picked a side with the toggle, which
 * sets data-mode on <html>. `lightOnly` (page builder) and a disabled toggle emit light only.
 */
export function themeCss(theme: ResolvedTheme, options: { lightOnly?: boolean } = {}): string {
  const light = `html:root{${declarations({ ...theme.shared, ...theme.light })};color-scheme:light}`
  if (options.lightOnly || !theme.allowModeToggle) return light
  const dark = `${declarations(theme.dark)};color-scheme:dark`
  return [
    light,
    `@media (prefers-color-scheme: dark){html:root:not([data-mode="light"]){${dark}}}`,
    `html:root[data-mode="dark"]{${dark}}`,
  ].join('\n')
}

/**
 * One mode, whatever the visitor's system or toggle says: for the admin's page preview, which has no
 * script to set data-mode (`html:root:root` outranks the light rule from themeCss), and for the page
 * builder's canvas (a selector for its wrapper, so the editor's own panels stay light). `selector`
 * is always a constant from our code, never from settings.
 */
export function forcedModeCss(theme: ResolvedTheme, mode: 'light' | 'dark', selector = 'html:root:root'): string {
  return `${selector}{${declarations({ ...theme.shared, ...theme[mode] })};color-scheme:${mode}}`
}

/**
 * The page builder's (Puck's) own colours in dark mode, made from the site theme's dark colours so
 * the builder matches the rest of the admin: Puck's grey scale is a blend from the dark text colour
 * to the dark background (on the same light-to-dark steps as Puck's own greys), its "white" is the
 * dark surface and its "black" the dark text, and its blue accent is rebuilt from the primary
 * colour. Only theme values (all validated hex) go into it. Applied when the editor is dark, like
 * the admin: the owner's choice on <html data-mode>, else the system setting.
 */
export function puckDarkCss(theme: ResolvedTheme): string {
  const t = theme.dark
  const ink = t['--ink']
  const bg = t['--bg']
  const primary = t['--primary']
  // How far each of Puck's greys (01 darkest .. 12 lightest in light mode) sits from its text colour.
  const steps = [0.06, 0.14, 0.24, 0.34, 0.45, 0.56, 0.66, 0.75, 0.84, 0.91, 0.95, 0.98]
  const vars: Record<string, string> = {
    '--puck-color-white': t['--surface'],
    '--puck-color-black': ink,
  }
  steps.forEach((step, i) => {
    vars[`--puck-color-grey-${String(i + 1).padStart(2, '0')}`] = mix(ink, bg, step)
  })
  // Puck's azure: 06-12 are ever darker tints (hover and selection backgrounds), 05 the accent
  // itself, 01-04 the accent as text. Text steps start as blends toward the text colour and are then
  // nudged until they reach 4.5:1 on every background they can sit on, whatever the brand colour.
  const towardBg = [0.25, 0.45, 0.6, 0.72, 0.8, 0.87, 0.92]
  const tints = towardBg.map((step) => mix(primary, bg, step))
  tints.forEach((tint, i) => (vars[`--puck-color-azure-${String(i + 6).padStart(2, '0')}`] = tint))
  vars['--puck-color-azure-05'] = primary
  const textBackgrounds = [t['--surface'], bg, vars['--puck-color-grey-12'], ...tints.slice(3)]
  const towardInk = [0.8, 0.6, 0.42, 0.25]
  towardInk.forEach((step, i) => {
    vars[`--puck-color-azure-0${i + 1}`] = ensureContrastOnAll(mix(primary, ink, step), textBackgrounds, 4.5)
  })
  const body = `${declarations(vars)};color-scheme:dark`
  return [
    `@media (prefers-color-scheme: dark){html[data-follow-mode]:not([data-mode="light"]){${body}}}`,
    `html[data-follow-mode][data-mode="dark"]{${body}}`,
  ].join('\n')
}

// ---------------------------------------------------------------------------------------------
// Admin validation
// ---------------------------------------------------------------------------------------------

/** A readable-text check for one mode, or null when it is fine. Used when saving the settings. */
export function contrastProblem(input: ThemeSettings, mode: Mode): string | null {
  const theme = resolveTheme(input)
  const tokens = mode === 'light' ? theme.light : theme.dark
  const checks: Array<[string, string]> = [
    ['background', tokens['--bg']],
    ['cards', tokens['--surface']],
  ]
  for (const [where, color] of checks) {
    const ratio = contrast(tokens['--ink'], color)
    if (ratio < 4.5) {
      return `In ${mode} mode the text colour is hard to read on the ${where} (contrast ${ratio.toFixed(1)}:1, at least 4.5:1 is needed). Choose a darker text or a lighter ${where} for light themes, and the opposite for dark ones.`
    }
  }
  return null
}

export const validateHexColor = (value?: string | null) =>
  !value || isHex(value) ? true : 'Use a hex colour such as #e8590c.'
