'use server'

// First-time setup (rules in ../setup.ts). The site's basics and the theme steps use the usual
// settings and theme actions; email uses the Email settings form.
import { can } from '@pet-adopt/plugin-sdk'
import { headers } from 'next/headers'

import { recordActivity } from '../activity'
import { getAuth } from '../auth'
import { asRecord, run, UserError, type ActionResult } from '../result'
import { addSampleAboutPage, addSamplePets, removeSampleContent, sampleContentLeftMessage } from '../sample-content'
import { requirePermission, requireUser } from '../session'
import { createFirstAdmin, finishSetup } from '../setup'
import type { SessionUser } from '../types'

/**
 * `{ key, name, email, password }`: the first account, an admin, made with the key from the setup
 * link in the server's log. Signs them in. Public: the key is what proves it is the right person.
 */
export async function createFirstAdminAction(input: { key: string; name: string; email: string; password: string }): Promise<ActionResult> {
  return run(async () => {
    const raw = asRecord(input)
    const { id } = await createFirstAdmin(raw.key, { name: raw.name, email: raw.email, password: raw.password })
    const auth = await getAuth()
    const result = await auth.api.signInEmail({
      body: { email: String(raw.email).trim().toLowerCase(), password: String(raw.password) },
      headers: await headers(),
    })
    const user = result.user as { name: string }
    const actor: Pick<SessionUser, 'id' | 'name' | 'role'> = { id, name: user.name, role: 'admin' }
    await recordActivity({ actor, action: 'setup.first-account', area: 'users', summary: 'Created the first admin account (first-time setup)', subject: { id, label: user.name } })
  })
}

/** Adds the sample pets and About page (setup's "Sample content" step). */
export async function addSampleContentAction(): Promise<ActionResult<{ pets: number }>> {
  return run(async () => {
    const actor = await requirePermission('pets:edit')
    const pets = await addSamplePets()
    const about = await addSampleAboutPage()
    await recordActivity({ actor, action: 'setup.sample-content', area: 'pets', summary: `Added sample content (${pets} example pets${about ? ' and an About page' : ''})` })
    return { pets }
  })
}

/** Takes the sample content out again. */
export async function removeSampleContentAction(): Promise<ActionResult<{ pets: number }>> {
  return run(async () => {
    const actor = await requirePermission('pets:edit')
    const result = await removeSampleContent()
    // Whatever went is logged, even when something was left behind.
    if (result.pets > 0 || result.aboutPage) {
      await recordActivity({ actor, action: 'setup.sample-content-removed', area: 'pets', summary: `Removed the sample content (${result.pets} example pets${result.aboutPage ? ' and the About page' : ''})` })
    }
    if (result.left.length) throw new UserError(sampleContentLeftMessage(result))
    return { pets: result.pets }
  })
}

/**
 * Ends the guided setup, finished or skipped. Only needs an admin's role, not a confirmed email: the
 * email step may just have switched that rule on.
 */
export async function finishSetupAction(input: { skipped?: boolean }): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser()
    if (!can(user.role, 'settings:edit')) throw new UserError('Only an admin can finish the setup.')
    await finishSetup()
    await recordActivity({ actor: user, action: 'setup.done', area: 'settings', summary: asRecord(input).skipped ? 'Skipped the rest of the first-time setup' : 'Finished the first-time setup' })
  })
}
