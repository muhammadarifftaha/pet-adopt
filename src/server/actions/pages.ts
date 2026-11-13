'use server'

import { deletePage, getPageById, listPages, publishPage, savePageDetails, saveDraft, unpublishPage } from '../pages'
import { run, type ActionResult } from '../result'
import { requireUser } from '../session'
import type { Page } from '../types'

export async function listPagesAction(): Promise<ActionResult<Awaited<ReturnType<typeof listPages>>>> {
  return run(async () => {
    await requireUser()
    return listPages()
  })
}

export async function getPageAction(id: number): Promise<ActionResult<Page | null>> {
  return run(async () => {
    await requireUser()
    return getPageById(id)
  })
}

/** Title, address (slug) and share details. Pass `id` = null to create a page. */
export async function savePageDetailsAction(id: number | null, input: unknown): Promise<ActionResult<{ id: number; slug: string }>> {
  return run(async () => {
    await requireUser()
    return savePageDetails(id, input)
  })
}

/** Used by the page builder. Saving a draft never changes the live page. */
export async function saveDraftAction(id: number, data: unknown): Promise<ActionResult> {
  return run(async () => {
    await requireUser()
    await saveDraft(id, data)
  })
}

/** Makes the draft (or `data`, when given) the live page. */
export async function publishPageAction(id: number, data?: unknown): Promise<ActionResult<{ slug: string }>> {
  return run(async () => {
    await requireUser()
    return publishPage(id, data)
  })
}

export async function unpublishPageAction(id: number): Promise<ActionResult> {
  return run(async () => {
    await requireUser()
    await unpublishPage(id)
  })
}

export async function deletePageAction(id: number): Promise<ActionResult> {
  return run(async () => {
    await requireUser()
    await deletePage(id)
  })
}
