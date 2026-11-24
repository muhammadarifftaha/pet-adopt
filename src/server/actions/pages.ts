'use server'

import {
  archivePage,
  deletePage,
  ensureSystemPages,
  getPageById,
  listPages,
  listPageVersions,
  publishPage,
  restorePage,
  restorePageVersion,
  savePageDetails,
  saveDraft,
  unpublishPage,
} from '../pages'
import { assertId, run, type ActionResult } from '../result'
import { requireUser } from '../session'
import type { Page, PageVersionSummary } from '../types'

/** The version a save was based on: a finite number, or nothing (save regardless). */
const version = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

export async function listPagesAction(): Promise<ActionResult<Awaited<ReturnType<typeof listPages>>>> {
  return run(async () => {
    await requireUser()
    // A site set up before the homepage was a page gets it here, without a restart.
    await ensureSystemPages()
    return listPages()
  })
}

export async function getPageAction(id: number): Promise<ActionResult<Page | null>> {
  return run(async () => {
    await requireUser()
    return getPageById(assertId(id))
  })
}

/** Title, address (slug) and share details. Pass `id` = null to create a page. */
export async function savePageDetailsAction(id: number | null, input: unknown): Promise<ActionResult<{ id: number; slug: string }>> {
  return run(async () => {
    await requireUser()
    return savePageDetails(id === null ? null : assertId(id), input)
  })
}

/**
 * Used by the page builder. Saving a draft never changes the live page. Pass the `version` the
 * builder last received (the page's `updatedAt` in ms, returned by every save): if the page has
 * changed since, nothing is written and the error says to reload.
 */
export async function saveDraftAction(id: number, data: unknown, baseVersion?: number): Promise<ActionResult<{ version: number }>> {
  return run(async () => {
    const user = await requireUser()
    return saveDraft(assertId(id), data, version(baseVersion), user.id)
  })
}

/** Makes the draft (or `data`, when given) the live page. Takes the same `baseVersion` as saveDraftAction. */
export async function publishPageAction(
  id: number,
  data?: unknown,
  baseVersion?: number,
): Promise<ActionResult<{ slug: string; version: number }>> {
  return run(async () => {
    const user = await requireUser()
    return publishPage(assertId(id), data, version(baseVersion), user.id)
  })
}

export async function unpublishPageAction(id: number): Promise<ActionResult> {
  return run(async () => {
    await requireUser()
    await unpublishPage(assertId(id))
  })
}

/** Takes the page off the site and makes it read-only, until it is restored or deleted. */
export async function archivePageAction(id: number): Promise<ActionResult> {
  return run(async () => {
    await requireUser()
    await archivePage(assertId(id))
  })
}

/** Brings an archived page back exactly as it was. */
export async function restorePageAction(id: number): Promise<ActionResult> {
  return run(async () => {
    await requireUser()
    await restorePage(assertId(id))
  })
}

/** The page's saved versions, newest first. */
export async function listPageVersionsAction(id: number): Promise<ActionResult<PageVersionSummary[]>> {
  return run(async () => {
    await requireUser()
    return listPageVersions(assertId(id))
  })
}

/** Copies version `number` back into the draft. The live page changes only when it is published. */
export async function restorePageVersionAction(
  id: number,
  number: number,
  baseVersion?: number,
): Promise<ActionResult<{ version: number; number: number }>> {
  return run(async () => {
    const user = await requireUser()
    return restorePageVersion(assertId(id), assertId(number), { baseVersion: version(baseVersion), by: user.id })
  })
}

/** Deletes the page and its history for good. Only an archived page can be deleted. */
export async function deletePageAction(id: number): Promise<ActionResult> {
  return run(async () => {
    await requireUser()
    await deletePage(assertId(id))
  })
}
