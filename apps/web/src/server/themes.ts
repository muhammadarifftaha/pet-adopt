// Owners' own themes. Each is a built-in preset (`base`) with customisations laid over it, in the
// same shape as the settings' customTheme, and validated by the same rules (settings.ts). One of
// them, or a built-in preset, is in use: site_settings.active_theme_id, laid over the theme fields
// by getSettings. Text must stay readable (contrastProblem), as for the settings.
import { foldText } from '@pet-adopt/plugin-sdk'
import { asc, eq, sql } from 'drizzle-orm'

import { getDatabase } from '@/db/client'
import { safeRevalidate } from '@/lib/revalidate'
import { PRESET_OPTIONS, contrastProblem, type ThemeSettings } from '@/lib/theme'

import { asRecord, Fields, UserError, ValidationError, type FieldErrors } from './result'
import { MODES, parseCustomTheme } from './settings'
import type { ThemeRecord } from './types'

type CustomTheme = NonNullable<ThemeSettings['customTheme']>

const SETTINGS_ID = 1
const MAX_THEMES = 50

function toTheme(row: { id: number; name: string; base: string; settings: unknown; createdAt: Date; updatedAt: Date }): ThemeRecord {
  return {
    id: row.id,
    name: row.name,
    base: row.base,
    settings: (row.settings ?? {}) as CustomTheme,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** Keys that were cleared (null) are left out, so a stored theme only holds what was changed. */
function compact(value: Record<string, unknown>): CustomTheme {
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    if (v === null || v === undefined) continue
    if (typeof v === 'object' && !Array.isArray(v)) {
      const inner = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null && x !== undefined))
      if (Object.keys(inner).length) out[key] = inner
    } else {
      out[key] = v
    }
  }
  return out as CustomTheme
}

/** Readable text on the background and on cards, in both modes, for this base and customisations. */
function checkContrast(base: string, customTheme: CustomTheme, errors: FieldErrors) {
  const effective: ThemeSettings = { theme: base, customize: true, customTheme }
  for (const mode of MODES) {
    const problem = contrastProblem(effective, mode)
    if (problem) errors[`customTheme.${mode}.text`] ??= problem
  }
}

async function assertNameFree(name: string, exceptId?: number) {
  const { db, t } = await getDatabase()
  // At most MAX_THEMES rows: compared here, folded, so case and accents match on every database.
  const rows = await db.select({ id: t.themes.id, name: t.themes.name }).from(t.themes)
  if (rows.some((row) => row.id !== exceptId && foldText(row.name) === foldText(name))) throw new ValidationError({ name: 'Another theme already has this name.' })
}

export async function listThemes(): Promise<{ themes: ThemeRecord[]; activeThemeId: number | null; preset: string }> {
  const { db, t } = await getDatabase()
  const rows = await db.select().from(t.themes).orderBy(asc(t.themes.name))
  const [settings] = await db
    .select({ activeThemeId: t.siteSettings.activeThemeId, theme: t.siteSettings.theme })
    .from(t.siteSettings)
    .where(eq(t.siteSettings.id, SETTINGS_ID))
    .limit(1)
  return { themes: rows.map(toTheme), activeThemeId: settings?.activeThemeId ?? null, preset: settings?.theme ?? 'sunrise' }
}

export async function getTheme(id: number): Promise<ThemeRecord | null> {
  const { db, t } = await getDatabase()
  const [row] = await db.select().from(t.themes).where(eq(t.themes.id, id)).limit(1)
  return row ? toTheme(row) : null
}

/**
 * `{ name, preset }` starts from a built-in preset with no changes; `{ name, fromThemeId }`
 * duplicates one of the owner's themes.
 */
export async function createTheme(raw: unknown): Promise<{ id: number }> {
  const input = asRecord(raw)
  const f = new Fields(input, true)
  const name = f.requiredText('name', 60)
  const preset = input.fromThemeId === undefined ? f.oneOf('preset', PRESET_OPTIONS, { required: true }) : undefined
  const fromThemeId = input.fromThemeId !== undefined ? f.id('fromThemeId') : undefined
  f.done()

  const { db, t } = await getDatabase()
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(t.themes)
  if (Number(n) >= MAX_THEMES) throw new UserError(`You can keep up to ${MAX_THEMES} themes. Delete one first.`)
  await assertNameFree(name as string)

  let base = preset as string | undefined
  let settings: CustomTheme = {}
  if (fromThemeId) {
    const source = await getTheme(fromThemeId)
    if (!source) throw new UserError('That theme no longer exists.')
    base = source.base
    settings = source.settings
  }
  const now = new Date()
  const [row] = await db
    .insert(t.themes)
    .values({ name: name as string, base: base ?? 'sunrise', settings: settings as never, createdAt: now, updatedAt: now })
    .returning({ id: t.themes.id })
  return { id: row.id }
}

/**
 * `{ name?, base?, customTheme? }`. `customTheme` replaces the stored customisations as a whole
 * (the editor sends everything); a key set to null falls back to the base preset.
 */
export async function updateTheme(id: number, raw: unknown): Promise<ThemeRecord> {
  const input = asRecord(raw)
  const existing = await getTheme(id)
  if (!existing) throw new UserError('That theme no longer exists.')

  const f = new Fields(input)
  const name = f.requiredText('name', 60)
  const base = f.oneOf('base', PRESET_OPTIONS) ?? undefined
  const errors: FieldErrors = { ...f.errors }
  const customTheme =
    input.customTheme === undefined ? existing.settings : compact(parseCustomTheme(input.customTheme ?? {}, errors))
  checkContrast(base ?? existing.base, customTheme, errors)
  if (Object.keys(errors).length) throw new ValidationError(errors)
  if (name) await assertNameFree(name, id)

  const { db, t } = await getDatabase()
  const [row] = await db
    .update(t.themes)
    .set({
      ...(name ? { name } : {}),
      ...(base ? { base } : {}),
      settings: customTheme as never,
      updatedAt: new Date(),
    })
    .where(eq(t.themes.id, id))
    .returning()
  if (!row) throw new UserError('That theme no longer exists.')
  await revalidateIfActive(id)
  return toTheme(row)
}

/** The theme in use cannot be deleted: switch to another one first. */
export async function deleteTheme(id: number): Promise<void> {
  const { db, t } = await getDatabase()
  const [settings] = await db
    .select({ activeThemeId: t.siteSettings.activeThemeId })
    .from(t.siteSettings)
    .where(eq(t.siteSettings.id, SETTINGS_ID))
    .limit(1)
  if (settings?.activeThemeId === id) throw new UserError('This theme is in use. Switch to another theme before deleting it.')
  const [row] = await db.delete(t.themes).where(eq(t.themes.id, id)).returning({ id: t.themes.id })
  if (!row) throw new UserError('That theme no longer exists.')
}

/** `{ themeId }` uses one of the owner's themes; `{ preset }` goes back to a built-in preset as it is. */
export async function activateTheme(raw: unknown): Promise<void> {
  const input = asRecord(raw)
  const f = new Fields(input)
  const themeId = input.themeId !== undefined ? f.id('themeId') : undefined
  const preset = input.preset !== undefined ? f.oneOf('preset', PRESET_OPTIONS) : undefined
  f.done()
  if (!themeId && !preset) throw new ValidationError({ themeId: 'Choose a theme.' })

  const { db, t } = await getDatabase()
  await db.insert(t.siteSettings).values({ id: SETTINGS_ID }).onConflictDoNothing()
  if (themeId) {
    if (!(await getTheme(themeId))) throw new UserError('That theme no longer exists.')
    await db.update(t.siteSettings).set({ activeThemeId: themeId, updatedAt: new Date() }).where(eq(t.siteSettings.id, SETTINGS_ID))
  } else {
    // A built-in preset exactly as designed: no saved theme, no old customisations or brand colour.
    await db
      .update(t.siteSettings)
      .set({ activeThemeId: null, theme: preset as string, customize: false, primaryColor: null, updatedAt: new Date() })
      .where(eq(t.siteSettings.id, SETTINGS_ID))
  }
  safeRevalidate([['/', 'layout']])
}

async function revalidateIfActive(id: number) {
  const { db, t } = await getDatabase()
  const [settings] = await db
    .select({ activeThemeId: t.siteSettings.activeThemeId })
    .from(t.siteSettings)
    .where(eq(t.siteSettings.id, SETTINGS_ID))
    .limit(1)
  if (settings?.activeThemeId === id) safeRevalidate([['/', 'layout']])
}
