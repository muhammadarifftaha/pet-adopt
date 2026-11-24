// Site settings: one row that holds the brand, theme, contact details and menu.
import { eq } from 'drizzle-orm'

import { getDatabase } from '@/db/client'
import type * as S from '@/db/schema/sqlite'
import { validateLink, validateWebUrl } from '@/lib/links'
import { SOCIAL_PLATFORMS } from '@/lib/options'
import { safeRevalidate } from '@/lib/revalidate'
import {
  BUTTON_OPTIONS,
  DENSITY_OPTIONS,
  FONT_OPTIONS,
  PRESET_OPTIONS,
  RADIUS_OPTIONS,
  SHADOW_OPTIONS,
  TEXT_SIZE_OPTIONS,
  contrastProblem,
  validateHexColor,
  type Mode,
  type ThemeSettings,
} from '@/lib/theme'
import { normalizePhone } from '@/lib/whatsapp'

import { getMediaByIds } from './media'
import { asRecord, Fields, ValidationError, type FieldErrors } from './result'
import type { MediaItem, SiteSetting } from './types'

type SettingsRow = typeof S.siteSettings.$inferSelect
type CustomTheme = NonNullable<ThemeSettings['customTheme']>

const SETTINGS_ID = 1
/** Menu items and social links beyond this are certainly a mistake, and every one is rendered on every page. */
const MAX_LIST_ITEMS = 20

export const DEFAULT_SETTINGS: SiteSetting = {
  id: 0,
  siteName: 'Pet Adopt',
  tagline: 'Find your new best friend',
  logo: null,
  favicon: null,
  primaryColor: null,
  theme: 'sunrise',
  allowModeToggle: true,
  customize: false,
  customTheme: null,
  activeThemeId: null,
  whatsappNumber: null,
  whatsappMessage: "Hi! I'm interested in adopting {pet}.",
  address: null,
  openingHours: null,
  socials: [],
  nav: [],
  footerText: null,
  updatedAt: null,
}

/** The smallest favicon accepted. Browsers show 16 to 32 px, phones' home screens up to 180. */
export const FAVICON_MIN_SIZE = 32

/**
 * Why an image cannot be the favicon, or null when it can. Browsers squash a non-square icon, so it
 * must be square (within 5%, for crops that are a pixel or two off) and at least 32 px.
 */
export function faviconProblem(image: Pick<MediaItem, 'width' | 'height'> | undefined | null): string | null {
  if (!image) return 'That image no longer exists.'
  const { width, height } = image
  if (!width || !height) return null
  if (Math.abs(width - height) > Math.max(width, height) * 0.05) return `Use a square image (this one is ${width} × ${height} px).`
  if (Math.min(width, height) < FAVICON_MIN_SIZE) return `Use an image at least ${FAVICON_MIN_SIZE} × ${FAVICON_MIN_SIZE} px (this one is ${width} × ${height} px).`
  return null
}

function toSettings(row: SettingsRow, logo: SiteSetting['logo'], favicon: SiteSetting['favicon']): SiteSetting {
  return {
    id: row.id,
    siteName: row.siteName,
    tagline: row.tagline,
    logo,
    favicon,
    primaryColor: row.primaryColor,
    theme: row.theme,
    allowModeToggle: row.allowModeToggle,
    customize: row.customize,
    customTheme: (row.customTheme as SiteSetting['customTheme']) ?? null,
    activeThemeId: row.activeThemeId ?? null,
    whatsappNumber: row.whatsappNumber,
    whatsappMessage: row.whatsappMessage,
    address: row.address,
    openingHours: row.openingHours,
    socials: row.socials ?? [],
    nav: row.nav ?? [],
    footerText: row.footerText,
    updatedAt: row.updatedAt,
  }
}

/**
 * The site settings. When the owner uses one of their saved themes, it is laid over the theme
 * fields here (its base preset, its customisations, no separate brand colour), so everything that
 * reads the theme (public pages, admin, page builder) needs nothing else.
 */
export async function getSettings(): Promise<SiteSetting> {
  const { db, t } = await getDatabase()
  const [row] = await db.select().from(t.siteSettings).where(eq(t.siteSettings.id, SETTINGS_ID)).limit(1)
  if (!row) return DEFAULT_SETTINGS
  const ids = [row.logoId, row.faviconId].filter((id): id is number => Boolean(id))
  const images = ids.length ? await getMediaByIds(ids) : new Map<number, MediaItem>()
  const image = (id: number | null) => (id ? (images.get(id) ?? null) : null)
  const settings = toSettings(row, image(row.logoId), image(row.faviconId))
  if (row.activeThemeId) {
    const [theme] = await db.select().from(t.themes).where(eq(t.themes.id, row.activeThemeId)).limit(1)
    if (theme) {
      return {
        ...settings,
        theme: theme.base,
        customize: true,
        customTheme: (theme.settings as SiteSetting['customTheme']) ?? {},
        primaryColor: null,
      }
    }
  }
  return settings
}

const COLOR_KEYS = ['primary', 'background', 'surface', 'text', 'tint'] as const
export const MODES: Mode[] = ['light', 'dark']

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** One set of colours. Only the keys that were sent come back; null clears the whole set. */
function parseColors(raw: unknown, path: string, errors: FieldErrors): Record<string, string | null> | null {
  if (raw === null) return null
  if (!isPlainObject(raw)) {
    errors[path] = 'Must be an object.'
    return {}
  }
  const f = new Fields(raw)
  const colors: Record<string, string | null> = {}
  for (const key of COLOR_KEYS) {
    const value = f.text(key, 9, { validate: (s) => validateHexColor(s) })
    if (value !== undefined) colors[key] = value
  }
  for (const [key, message] of Object.entries(f.errors)) errors[`${path}.${key}`] = message
  return colors
}

/** Only the keys that were sent come back, so they can be merged into what is stored. */
export function parseCustomTheme(raw: unknown, errors: FieldErrors): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    errors.customTheme = 'Must be an object.'
    return {}
  }
  const f = new Fields(raw)
  const sent: Record<string, unknown> = {}
  const selects: Array<[string, readonly { value: string }[]]> = [
    ['headingFont', FONT_OPTIONS],
    ['bodyFont', FONT_OPTIONS],
    ['radius', RADIUS_OPTIONS],
    ['button', BUTTON_OPTIONS],
    ['shadow', SHADOW_OPTIONS],
    ['density', DENSITY_OPTIONS],
    ['textSize', TEXT_SIZE_OPTIONS],
  ]
  for (const [key, options] of selects) {
    const value = f.oneOf(key, options)
    if (value !== undefined) sent[key] = value
  }
  for (const mode of MODES) {
    if (raw[mode] !== undefined) sent[mode] = parseColors(raw[mode], `customTheme.${mode}`, errors)
  }
  for (const [key, message] of Object.entries(f.errors)) errors[`customTheme.${key}`] = message
  return sent
}

/**
 * What is stored, with the keys that were sent laid over it. Sending `{ radius: 'lg' }` changes the
 * corners and keeps every saved colour; sending a key as null clears just that one.
 */
function mergeCustomTheme(stored: SiteSetting['customTheme'], sent: Record<string, unknown>): CustomTheme {
  const base = (stored ?? {}) as Record<string, unknown>
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(sent)) {
    if (MODES.includes(key as Mode)) {
      merged[key] = value === null ? {} : { ...(isPlainObject(base[key]) ? base[key] : {}), ...(value as object) }
    } else {
      merged[key] = value
    }
  }
  return merged as CustomTheme
}

/** Admin only (checked by the caller). Keys that are left out stay as they are, at every level. */
export async function updateSettings(raw: unknown): Promise<SiteSetting> {
  const input = asRecord(raw)
  const { db, t } = await getDatabase()
  const [stored] = await db.select().from(t.siteSettings).where(eq(t.siteSettings.id, SETTINGS_ID)).limit(1)

  const f = new Fields(input)
  const v: Partial<typeof S.siteSettings.$inferInsert> = {}
  const put = <K extends keyof typeof v>(key: K, value: (typeof v)[K] | undefined) => {
    if (value !== undefined) v[key] = value
  }

  put('siteName', f.requiredText('siteName', 80))
  put('tagline', f.text('tagline', 160))
  put('logoId', f.id('logoId'))
  put('faviconId', f.id('faviconId'))
  put('primaryColor', f.text('primaryColor', 9, { validate: (s) => validateHexColor(s) }))
  put('theme', f.oneOf('theme', PRESET_OPTIONS) ?? undefined)
  put('allowModeToggle', f.flag('allowModeToggle'))
  put('customize', f.flag('customize'))
  put(
    'whatsappNumber',
    f.text('whatsappNumber', 40, { validate: (s) => normalizePhone(s) !== '' || 'Enter a valid number, for example +60 12-345 6789.' }),
  )
  put('whatsappMessage', f.text('whatsappMessage', 300))
  put('address', f.text('address', 500))
  put('openingHours', f.text('openingHours', 500))
  put('footerText', f.text('footerText', 500))

  const errors: FieldErrors = { ...f.errors }

  if (input.customTheme !== undefined) {
    v.customTheme = input.customTheme === null ? null : mergeCustomTheme(stored?.customTheme as SiteSetting['customTheme'], parseCustomTheme(input.customTheme, errors))
  }

  // Text must stay readable on the background and on cards, in each mode. That depends on the
  // preset, the brand colour AND the custom colours together, and changing any one of them can
  // break a combination that was fine, so check the effective result whenever any of them is sent.
  if (['theme', 'primaryColor', 'customize', 'customTheme'].some((key) => input[key] !== undefined)) {
    const effective: ThemeSettings = {
      theme: v.theme ?? stored?.theme,
      primaryColor: v.primaryColor !== undefined ? v.primaryColor : stored?.primaryColor,
      customize: v.customize ?? stored?.customize ?? false,
      customTheme: (v.customTheme !== undefined ? v.customTheme : stored?.customTheme) as ThemeSettings['customTheme'],
    }
    if (effective.customize) {
      for (const mode of MODES) {
        const problem = contrastProblem(effective, mode)
        if (problem) errors[`customTheme.${mode}.text`] ??= problem
      }
    }
  }

  // null clears a list, like it clears any other field.
  const list = (key: string): unknown[] | undefined => {
    const value = input[key]
    if (value === undefined) return undefined
    if (value === null) return []
    if (!Array.isArray(value)) {
      errors[key] = 'Must be a list.'
      return undefined
    }
    if (value.length > MAX_LIST_ITEMS) {
      errors[key] = `Use at most ${MAX_LIST_ITEMS} items.`
      return undefined
    }
    return value
  }
  const socials = list('socials')
  if (socials) {
    v.socials = socials.map((item, i) => {
      const row = new Fields(asRecord(item), true)
      const platform = row.oneOf('platform', SOCIAL_PLATFORMS, { required: true })
      const url = row.requiredText('url', 300, { validate: (s) => validateWebUrl(s) })
      for (const [key, message] of Object.entries(row.errors)) errors[`socials.${i}.${key}`] = message
      return { platform: platform ?? '', url: url ?? '' }
    })
  }
  const nav = list('nav')
  if (nav) {
    v.nav = nav.map((item, i) => {
      const row = new Fields(asRecord(item), true)
      const label = row.requiredText('label', 40)
      const href = row.requiredText('href', 300, { validate: (s) => validateLink(s) })
      for (const [key, message] of Object.entries(row.errors)) errors[`nav.${i}.${key}`] = message
      return { label: label ?? '', href: href ?? '' }
    })
  }

  if (Object.keys(errors).length) throw new ValidationError(errors)
  const chosen = [v.logoId, v.faviconId].filter((id): id is number => Boolean(id))
  const images = chosen.length ? await getMediaByIds(chosen) : new Map<number, MediaItem>()
  if (v.logoId && !images.has(v.logoId)) errors.logoId = 'That image no longer exists.'
  if (v.faviconId) {
    const problem = faviconProblem(images.get(v.faviconId))
    if (problem) errors.faviconId = problem
  }
  if (Object.keys(errors).length) throw new ValidationError(errors)

  await db.insert(t.siteSettings).values({ id: SETTINGS_ID }).onConflictDoNothing()
  await db.update(t.siteSettings).set({ ...v, updatedAt: new Date() }).where(eq(t.siteSettings.id, SETTINGS_ID))
  safeRevalidate([['/', 'layout']])
  return getSettings()
}
