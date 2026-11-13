'use server'

import { getMedia, listMedia, mediaUsage, updateMediaAlt } from '../media'
import { run, UserError, ValidationError, type ActionResult } from '../result'
import { requireUser } from '../session'
import type { MediaItem } from '../types'
import { removeUpload, saveUpload } from '../uploads'

/** Library listing: `{ page, search }`. */
export async function listMediaAction(opts: { page?: number; search?: string; limit?: number } = {}): Promise<ActionResult<Awaited<ReturnType<typeof listMedia>>>> {
  return run(async () => {
    await requireUser()
    return listMedia({ page: opts.page, search: opts.search, limit: opts.limit ?? 24 })
  })
}

export async function getMediaAction(id: number): Promise<ActionResult<{ media: MediaItem; usage: Awaited<ReturnType<typeof mediaUsage>> } | null>> {
  return run(async () => {
    await requireUser()
    const media = await getMedia(id)
    return media ? { media, usage: await mediaUsage(id) } : null
  })
}

/** FormData fields: `file` (an image up to 10 MB) and `alt` (a short description). */
export async function uploadMediaAction(formData: FormData): Promise<ActionResult<MediaItem>> {
  return run(async () => {
    await requireUser()
    const file = formData.get('file')
    if (!(file instanceof File) || file.size === 0) throw new ValidationError({ file: 'Choose an image to upload.' })
    const alt = formData.get('alt')
    return saveUpload({ data: Buffer.from(await file.arrayBuffer()), alt: typeof alt === 'string' ? alt : '' })
  })
}

export async function updateMediaAltAction(id: number, alt: string): Promise<ActionResult<MediaItem>> {
  return run(async () => {
    await requireUser()
    return updateMediaAlt(id, alt)
  })
}

/** Refused (with a message saying where it is used) while a pet, page or the logo uses the image. */
export async function deleteMediaAction(id: number): Promise<ActionResult> {
  return run(async () => {
    await requireUser()
    if (!Number.isInteger(id)) throw new UserError('Image not found.')
    await removeUpload(id)
  })
}
