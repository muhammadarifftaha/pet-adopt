'use server'

import { run, type ActionResult } from '../result'
import { requirePermission } from '../session'
import { getSettings, updateSettings } from '../settings'
import type { SiteSetting } from '../types'

export async function getSettingsAction(): Promise<ActionResult<SiteSetting>> {
  return run(async () => {
    await requirePermission('settings:view')
    return getSettings()
  })
}

/**
 * Admins only. Send only the keys you are changing. Nested theme colours are
 * `customTheme.light.primary`, `customTheme.dark.text` and so on in `fieldErrors`.
 */
export async function updateSettingsAction(input: unknown): Promise<ActionResult<SiteSetting>> {
  return run(async () => {
    await requirePermission('settings:edit')
    return updateSettings(input)
  })
}
