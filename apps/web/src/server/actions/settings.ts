'use server'

import { changedFields, recordActivity } from '../activity'
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
 * Admins and developers (`settings:edit`). Send only the keys you are changing. Nested theme colours are
 * `customTheme.light.primary`, `customTheme.dark.text` and so on in `fieldErrors`.
 */
export async function updateSettingsAction(input: unknown): Promise<ActionResult<SiteSetting>> {
  return run(async () => {
    const user = await requirePermission('settings:edit')
    const before = await getSettings()
    const after = await updateSettings(input)
    const fields = changedFields(before, after)
    if (fields.length) await recordActivity({ actor: user, action: 'settings.update', area: 'settings', summary: 'Changed the site settings', fields })
    return after
  })
}
