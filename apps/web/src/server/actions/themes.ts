'use server'

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
    await requirePermission('theme:edit')
    return createTheme(input)
  })
}

/** `{ name?, base?, customTheme? }`; `customTheme` replaces the theme's customisations. */
export async function updateThemeAction(id: number, input: unknown): Promise<ActionResult<ThemeRecord>> {
  return run(async () => {
    await requirePermission('theme:edit')
    return updateTheme(assertId(id), input)
  })
}

export async function deleteThemeAction(id: number): Promise<ActionResult> {
  return run(async () => {
    await requirePermission('theme:edit')
    await deleteTheme(assertId(id))
  })
}

/** `{ themeId }` or `{ preset }`: what the whole site uses from now on. */
export async function activateThemeAction(input: unknown): Promise<ActionResult> {
  return run(async () => {
    await requirePermission('theme:edit')
    await activateTheme(input)
  })
}
