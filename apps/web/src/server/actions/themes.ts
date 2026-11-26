'use server'

import { changedFields, quoted, recordActivity } from '../activity'
import { activateTheme, createTheme, deleteTheme, getTheme, listThemes, updateTheme } from '../themes'
import { assertId, run, type ActionResult } from '../result'
import { requirePermission } from '../session'
import type { ThemeRecord } from '../types'

// The Theme screen (admin only, like the site settings it changes).

export async function listThemesAction(): Promise<ActionResult<Awaited<ReturnType<typeof listThemes>>>> {
  return run(async () => {
    await requirePermission('theme:view')
    return listThemes()
  })
}

export async function getThemeAction(id: number): Promise<ActionResult<ThemeRecord | null>> {
  return run(async () => {
    await requirePermission('theme:view')
    return getTheme(assertId(id))
  })
}

/** `{ name, preset }` from a built-in preset, or `{ name, fromThemeId }` to duplicate a theme. */
export async function createThemeAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  return run(async () => {
    const user = await requirePermission('theme:edit')
    const created = await createTheme(input)
    const theme = await getTheme(created.id)
    await recordActivity({ actor: user, action: 'theme.create', area: 'theme', summary: `Created the theme ${quoted(theme?.name)}`, subject: { id: created.id, label: theme?.name } })
    return created
  })
}

/** `{ name?, base?, customTheme? }`; `customTheme` replaces the theme's customisations. */
export async function updateThemeAction(id: number, input: unknown): Promise<ActionResult<ThemeRecord>> {
  return run(async () => {
    const user = await requirePermission('theme:edit')
    const themeId = assertId(id)
    const before = await getTheme(themeId)
    const after = await updateTheme(themeId, input)
    await recordActivity({
      actor: user,
      action: 'theme.update',
      area: 'theme',
      summary: `Updated the theme ${quoted(after.name)}`,
      subject: { id: themeId, label: after.name },
      fields: changedFields(before, after),
    })
    return after
  })
}

export async function deleteThemeAction(id: number): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePermission('theme:edit')
    const themeId = assertId(id)
    const before = await getTheme(themeId)
    await deleteTheme(themeId)
    await recordActivity({ actor: user, action: 'theme.delete', area: 'theme', summary: `Deleted the theme ${quoted(before?.name)}`, subject: { id: themeId, label: before?.name } })
  })
}

/** `{ themeId }` or `{ preset }`: what the whole site uses from now on. */
export async function activateThemeAction(input: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePermission('theme:edit')
    await activateTheme(input)
    const { activeThemeId, preset } = await listThemes()
    const theme = activeThemeId === null ? null : await getTheme(activeThemeId)
    await recordActivity({
      actor: user,
      action: 'theme.activate',
      area: 'theme',
      summary: theme ? `Switched the site to the theme ${quoted(theme.name)}` : `Switched the site to the built-in theme ${quoted(preset)}`,
      subject: theme ? { id: theme.id, label: theme.name } : { id: `preset:${preset}`, label: preset },
    })
  })
}
