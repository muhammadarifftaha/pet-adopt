'use server'

import { changedFields, quoted, recordActivity, type Actor } from '../activity'
import { getMedia, getMediaByIds, listMedia, mediaUsage, updateMediaAlt, updateMediaDetails } from '../media'
import { assertId, run, UserError, ValidationError, type ActionResult } from '../result'
import { requirePermission } from '../session'
import type { MediaItem } from '../types'
import { removeUpload, saveUpload } from '../uploads'

// Not actions (this file only exports async functions): what goes into the activity log.
const label = (media: MediaItem | null | undefined) => media?.name || media?.filename || null

async function recordUpdate(user: Actor, before: MediaItem | null, after: MediaItem) {
  const fields = changedFields(before && { name: before.name, 'alt text': before.alt }, { name: after.name, 'alt text': after.alt })
  if (!fields.length) return
  await recordActivity({ actor: user, action: 'media.update', area: 'media', summary: `Updated the image ${quoted(label(after))}`, subject: { id: after.id, label: label(after) }, fields })
}

async function recordDelete(user: Actor, id: number, before: MediaItem | null) {
  await recordActivity({ actor: user, action: 'media.delete', area: 'media', summary: `Deleted the image ${quoted(label(before))}`, subject: { id, label: label(before) } })
}

/** Library listing: `{ page, search }`. */
export async function listMediaAction(opts: { page?: number; search?: string; limit?: number } = {}): Promise<ActionResult<Awaited<ReturnType<typeof listMedia>>>> {
  return run(async () => {
    await requirePermission('media:view')
    return listMedia({ page: opts.page, search: opts.search, limit: opts.limit ?? 24 })
  })
}

export async function getMediaAction(id: number): Promise<ActionResult<{ media: MediaItem; usage: Awaited<ReturnType<typeof mediaUsage>> } | null>> {
  return run(async () => {
    await requirePermission('media:view')
    const mediaId = assertId(id)
    const media = await getMedia(mediaId)
    return media ? { media, usage: await mediaUsage(mediaId) } : null
  })
}

/** FormData fields: `file` (an image up to 10 MB), `alt` (a short description) and optional `name` (display name). */
export async function uploadMediaAction(formData: FormData): Promise<ActionResult<MediaItem>> {
  return run(async () => {
    const user = await requirePermission('media:edit')
    const file = formData.get('file')
    if (!(file instanceof File) || file.size === 0) throw new ValidationError({ file: 'Choose an image to upload.' })
    const alt = formData.get('alt')
    // The display name: the one typed in the upload dialog, else the file's own name.
    const name = formData.get('name')
    const media = await saveUpload({
      data: Buffer.from(await file.arrayBuffer()),
      alt: typeof alt === 'string' ? alt : '',
      name: typeof name === 'string' && name.trim() ? name : file.name,
    })
    await recordActivity({ actor: user, action: 'media.upload', area: 'media', summary: `Uploaded the image ${quoted(label(media))}`, subject: { id: media.id, label: label(media) } })
    return media
  })
}

export async function updateMediaAltAction(id: number, alt: string): Promise<ActionResult<MediaItem>> {
  return run(async () => {
    const user = await requirePermission('media:edit')
    const mediaId = assertId(id)
    const before = await getMedia(mediaId)
    const after = await updateMediaAlt(mediaId, typeof alt === 'string' ? alt : '')
    await recordUpdate(user, before, after)
    return after
  })
}

/** Refused (with a message saying where it is used) while a pet, page layout or the logo uses the image. */
export async function deleteMediaAction(id: number): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePermission('media:edit')
    const mediaId = assertId(id)
    const before = await getMedia(mediaId)
    await removeUpload(mediaId)
    await recordDelete(user, mediaId, before)
  })
}

const MAX_BULK = 100

/**
 * Deletes several images, each on its own: one that is still in use (or already gone) is skipped
 * with its reason, and the rest are deleted. Up to 100 at a time (a full library page).
 */
export async function deleteManyMediaAction(ids: number[]): Promise<ActionResult<{ deleted: number[]; failed: Array<{ id: number; message: string }> }>> {
  return run(async () => {
    const user = await requirePermission('media:edit')
    if (!Array.isArray(ids) || ids.length === 0) throw new ValidationError({ ids: 'Choose at least one image.' })
    if (ids.length > MAX_BULK) throw new ValidationError({ ids: `Choose at most ${MAX_BULK} images at a time.` })
    const unique = [...new Set(ids.map((id) => assertId(id)))]
    const deleted: number[] = []
    const failed: Array<{ id: number; message: string }> = []
    const before = await getMediaByIds(unique)
    // One after another: each delete checks where the image is used, and the files are removed last.
    for (const id of unique) {
      try {
        await removeUpload(id)
        deleted.push(id)
        await recordDelete(user, id, before.get(id) ?? null)
      } catch (error) {
        if (error instanceof UserError) failed.push({ id, message: error.message })
        else throw error
      }
    }
    return { deleted, failed }
  })
}

/** The image page's form: `{ name, alt }`, saved together; field errors on `name` and `alt`. */
export async function updateMediaDetailsAction(id: number, input: { name: string; alt: string }): Promise<ActionResult<MediaItem>> {
  return run(async () => {
    const user = await requirePermission('media:edit')
    const mediaId = assertId(id)
    const fields = input && typeof input === 'object' ? input : { name: '', alt: '' }
    const before = await getMedia(mediaId)
    const after = await updateMediaDetails(mediaId, { name: String(fields.name ?? ''), alt: String(fields.alt ?? '') })
    await recordUpdate(user, before, after)
    return after
  })
}
