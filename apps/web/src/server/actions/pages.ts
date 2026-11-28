'use server'

import {
  archivePage,
  deletePage,
  ensureSystemPages,
  getPageById,
  listPages,
  listPageVersions,
  publishPage,
  restoreAndPublishPageVersion,
  restorePage,
  restorePageVersion,
  savePageDetails,
  unpublishPage,
} from '../pages'
import { changedFields, pageSettings, recordPageActivity } from '../activity'
import { assertId, run, type ActionResult } from '../result'
import { requirePermission } from '../session'
import type { Page, PageVersionSummary } from '../types'

/** The version a save was based on: a finite number, or nothing (save regardless). */
const version = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

export async function listPagesAction(): Promise<ActionResult<Awaited<ReturnType<typeof listPages>>>> {
  return run(async () => {
    await requirePermission('pages:view')
    // A site set up before the homepage was a page gets it here, without a restart.
    await ensureSystemPages()
    return listPages()
  })
}

export async function getPageAction(id: number): Promise<ActionResult<Page | null>> {
  return run(async () => {
    await requirePermission('pages:view')
    return getPageById(assertId(id))
  })
}

/** Title, address (slug) and share details. Pass `id` = null to create a page. */
export async function savePageDetailsAction(id: number | null, input: unknown): Promise<ActionResult<{ id: number; slug: string }>> {
  return run(async () => {
    const user = await requirePermission('pages:edit')
    const pageId = id === null ? null : assertId(id)
    const before = pageId === null ? null : await getPageById(pageId)
    const saved = await savePageDetails(pageId, input, { by: user.id })
    const after = await getPageById(saved.id)
    if (pageId === null) {
      await recordPageActivity(user, saved.id, 'page.create', (title) => `Created the page ${title}`)
    } else {
      // On a live page the settings wait for Publish, like the layout.
      const pending = Boolean(after?.draftDetails)
      await recordPageActivity(user, saved.id, 'page.settings', (title) => `Changed the settings of the page ${title}${pending ? ' (draft, not live yet)' : ''}`, {
        fields: changedFields(pageSettings(before), pageSettings(after)),
      })
    }
    return saved
  })
}

/**
 * Makes the draft (or `data`, when given) the live page. Pass the `baseVersion` last received (the
 * page's `updatedAt` in ms, returned by every save): if the page has changed since, nothing is
 * written and the error says to reload.
 */
export async function publishPageAction(
  id: number,
  data?: unknown,
  baseVersion?: number,
): Promise<ActionResult<{ slug: string; version: number }>> {
  return run(async () => {
    const user = await requirePermission('pages:edit')
    const pageId = assertId(id)
    const published = await publishPage(pageId, data, version(baseVersion), user.id)
    await recordPageActivity(user, pageId, 'page.publish', (title) => `Published the page ${title}`)
    return published
  })
}

export async function unpublishPageAction(id: number): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePermission('pages:edit')
    const pageId = assertId(id)
    await unpublishPage(pageId)
    await recordPageActivity(user, pageId, 'page.unpublish', (title) => `Unpublished the page ${title}`)
  })
}

/** Takes the page off the site and makes it read-only, until it is restored or deleted. */
export async function archivePageAction(id: number): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePermission('pages:edit')
    const pageId = assertId(id)
    await archivePage(pageId)
    await recordPageActivity(user, pageId, 'page.archive', (title) => `Archived the page ${title}`)
  })
}

/** Brings an archived page back exactly as it was. */
export async function restorePageAction(id: number): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePermission('pages:edit')
    const pageId = assertId(id)
    await restorePage(pageId)
    await recordPageActivity(user, pageId, 'page.restore', (title) => `Brought back the archived page ${title}`)
  })
}

/** The page's saved versions, newest first. */
export async function listPageVersionsAction(id: number): Promise<ActionResult<PageVersionSummary[]>> {
  return run(async () => {
    await requirePermission('pages:view')
    return listPageVersions(assertId(id))
  })
}

/** Restores version `number` as a new version and publishes it, in one step (a quick rollback). */
export async function restoreAndPublishPageVersionAction(
  id: number,
  number: number,
  baseVersion?: number,
): Promise<ActionResult<{ version: number; number: number }>> {
  return run(async () => {
    const user = await requirePermission('pages:edit')
    const pageId = assertId(id)
    const from = assertId(number)
    const result = await restoreAndPublishPageVersion(pageId, from, { baseVersion: version(baseVersion), by: user.id })
    await recordPageActivity(user, pageId, 'page.version.restore-publish', (title) => `Restored version ${from} of the page ${title} as version ${result.number} and published it`)
    return result
  })
}

/** Copies version `number` back into the draft. The live page changes only when it is published. */
export async function restorePageVersionAction(
  id: number,
  number: number,
  baseVersion?: number,
): Promise<ActionResult<{ version: number; number: number }>> {
  return run(async () => {
    const user = await requirePermission('pages:edit')
    const pageId = assertId(id)
    const from = assertId(number)
    const result = await restorePageVersion(pageId, from, { baseVersion: version(baseVersion), by: user.id })
    await recordPageActivity(user, pageId, 'page.version.restore', (title) => `Restored version ${from} of the page ${title} as a draft (version ${result.number})`)
    return result
  })
}

/** Deletes the page and its history for good. Only an archived page can be deleted. */
export async function deletePageAction(id: number): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePermission('pages:edit')
    const pageId = assertId(id)
    const before = await getPageById(pageId)
    await deletePage(pageId)
    await recordPageActivity(user, pageId, 'page.delete', (title) => `Deleted the page ${title} and its history`, { title: before?.title ?? null })
  })
}
