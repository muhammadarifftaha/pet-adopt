// Turning an uploaded file into a media record: check it really is a raster image, store it with a
// random name, make a small preview, and save the row.
import { randomBytes } from 'node:crypto'

import sharp, { type Metadata } from 'sharp'

import { createMediaRow, deleteMediaRow } from './media'
import { thumbnailFilename } from './media-url'
import { UserError, ValidationError } from './result'
import { getStorage } from './storage'
import type { MediaItem } from './types'

export const MAX_UPLOAD_BYTES = 10_000_000

// Decided from the file's actual contents, not its name or the browser's claim.
// No SVG: an uploaded SVG can carry script and would run on the site's own origin.
const FORMATS: Record<string, { ext: string; mime: string }> = {
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  webp: { ext: 'webp', mime: 'image/webp' },
  avif: { ext: 'avif', mime: 'image/avif' },
  gif: { ext: 'gif', mime: 'image/gif' },
}

export async function saveUpload(input: { data: Buffer; alt: string }): Promise<MediaItem> {
  const alt = input.alt.trim()
  if (!alt) throw new ValidationError({ alt: 'Describe the image in a few words. It is used for accessibility and search.' })
  if (alt.length > 200) throw new ValidationError({ alt: 'Keep the description under 200 characters.' })
  if (!input.data.length) throw new ValidationError({ file: 'Choose an image to upload.' })
  if (input.data.length > MAX_UPLOAD_BYTES) throw new ValidationError({ file: 'The image is larger than 10 MB.' })

  let meta: Metadata
  try {
    meta = await sharp(input.data).metadata()
  } catch {
    throw new ValidationError({ file: 'This file is not a readable image.' })
  }
  const format = meta.format ? FORMATS[meta.format] : undefined
  if (!format) throw new ValidationError({ file: 'Use a JPEG, PNG, WebP, AVIF or GIF image.' })

  const filename = `${randomBytes(16).toString('hex')}.${format.ext}`
  const thumbnail = thumbnailFilename(filename)
  const preview = await sharp(input.data).rotate().resize(320, 240, { fit: 'cover' }).webp({ quality: 75 }).toBuffer()

  const storage = await getStorage()
  await storage.put(filename, input.data, format.mime)
  await storage.put(thumbnail, preview, 'image/webp')
  try {
    return await createMediaRow({
      filename,
      mimeType: format.mime,
      size: input.data.length,
      width: meta.width ?? null,
      height: meta.height ?? null,
      alt,
    })
  } catch (error) {
    // Don't leave orphaned files behind.
    await Promise.allSettled([storage.delete(filename), storage.delete(thumbnail)])
    throw error
  }
}

/** Deletes an image, unless a pet, page or the site logo still uses it. */
export async function removeUpload(id: number): Promise<void> {
  const filename = await deleteMediaRow(id)
  const storage = await getStorage()
  await Promise.allSettled([storage.delete(filename), storage.delete(thumbnailFilename(filename))])
}

export { UserError }
