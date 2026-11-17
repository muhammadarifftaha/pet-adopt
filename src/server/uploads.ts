// Turning an uploaded file into a media record: check it really is a raster image, re-encode it
// (which drops EXIF, so a phone photo's GPS position never gets published), store it with a random
// name, make a small preview, and save the row.
import { randomBytes } from 'node:crypto'

import sharp, { type Metadata, type Sharp } from 'sharp'

import { createMediaRow, deleteMediaRow } from './media'
import { thumbnailFilename } from './media-url'
import { describeError, ValidationError } from './result'
import { getStorage, type Storage } from './storage'
import type { MediaItem } from './types'

export const MAX_UPLOAD_BYTES = 10_000_000
/** About 6300 x 6300. A small file can still decode to gigabytes of pixels; refuse those before decoding. */
const MAX_PIXELS = 40_000_000
const MAX_SIDE = 12_000
/** Frames of an animated GIF or WebP. */
const MAX_FRAMES = 100

// Image work is CPU and memory heavy; keep it from taking over a small server.
sharp.concurrency(2)

type Kind = { ext: string; mime: string; encode: (pipeline: Sharp) => Sharp }

// Decided from the file's actual contents, not its name or the browser's claim.
// No SVG: an uploaded SVG can carry script and would run on the site's own origin.
// No HEIC (what iPhones save by default): it has no browser support.
function kindOf(meta: Metadata): Kind | undefined {
  switch (meta.format) {
    case 'jpeg':
      return { ext: 'jpg', mime: 'image/jpeg', encode: (p) => p.jpeg({ quality: 90, mozjpeg: true }) }
    case 'png':
      return { ext: 'png', mime: 'image/png', encode: (p) => p.png({ compressionLevel: 9 }) }
    case 'webp':
      return { ext: 'webp', mime: 'image/webp', encode: (p) => p.webp({ quality: 90 }) }
    case 'gif':
      return { ext: 'gif', mime: 'image/gif', encode: (p) => p.gif() }
    case 'heif':
      // sharp reports AVIF as "heif" with AV1 compression; HEIC is the same container with HEVC.
      return meta.compression === 'av1' ? { ext: 'avif', mime: 'image/avif', encode: (p) => p.avif({ quality: 60 }) } : undefined
    default:
      return undefined
  }
}

/** Removes stored files, and says so when one cannot be removed instead of leaving an orphan unnoticed. */
async function removeFiles(storage: Storage, keys: string[]) {
  const results = await Promise.allSettled(keys.map((key) => storage.delete(key)))
  results.forEach((result, i) => {
    if (result.status === 'rejected') console.warn(`Could not remove stored file ${keys[i]}: ${describeError(result.reason)}`)
  })
}

export async function saveUpload(input: { data: Buffer; alt: string }): Promise<MediaItem> {
  const alt = input.alt.trim()
  if (!alt) throw new ValidationError({ alt: 'Describe the image in a few words. It is used for accessibility and search.' })
  if (alt.length > 200) throw new ValidationError({ alt: 'Keep the description under 200 characters.' })
  if (!input.data.length) throw new ValidationError({ file: 'Choose an image to upload.' })
  if (input.data.length > MAX_UPLOAD_BYTES) throw new ValidationError({ file: 'The image is larger than 10 MB.' })

  let meta: Metadata
  try {
    meta = await sharp(input.data, { limitInputPixels: MAX_PIXELS }).metadata()
  } catch {
    throw new ValidationError({ file: 'This file is not a readable image, or it is too large.' })
  }
  const kind = kindOf(meta)
  if (!kind) throw new ValidationError({ file: 'Use a JPEG, PNG, WebP, AVIF or GIF image.' })
  const frames = meta.pages ?? 1
  if (!meta.width || !meta.height || meta.width > MAX_SIDE || meta.height > MAX_SIDE) {
    throw new ValidationError({ file: `The image is too large. Use one up to ${MAX_SIDE} pixels on each side.` })
  }
  if (frames > MAX_FRAMES) throw new ValidationError({ file: `The animation has too many frames (up to ${MAX_FRAMES}).` })

  let clean: Buffer
  let width: number
  let height: number
  let preview: Buffer
  try {
    // Re-encoding applies the camera's rotation and drops every metadata block (EXIF with GPS and
    // device details, XMP, comments) and anything appended after the image data.
    const result = await kind
      .encode(sharp(input.data, { limitInputPixels: MAX_PIXELS, animated: frames > 1, failOn: 'error' }).rotate())
      .toBuffer({ resolveWithObject: true })
    clean = result.data
    width = result.info.width
    height = frames > 1 ? (meta.pageHeight ?? result.info.height) : result.info.height
    preview = await sharp(clean).resize(320, 240, { fit: 'cover' }).webp({ quality: 75 }).toBuffer()
  } catch {
    throw new ValidationError({ file: 'This image could not be processed. Try saving it again as a JPEG or PNG.' })
  }

  const filename = `${randomBytes(16).toString('hex')}.${kind.ext}`
  const thumbnail = thumbnailFilename(filename)
  const storage = await getStorage()
  const written: string[] = []
  try {
    await storage.put(filename, clean, kind.mime)
    written.push(filename)
    await storage.put(thumbnail, preview, 'image/webp')
    written.push(thumbnail)
    return await createMediaRow({ filename, mimeType: kind.mime, size: clean.length, width, height, alt })
  } catch (error) {
    // A failure at any step (the second file, the database) must not leave the first one behind.
    await removeFiles(storage, written)
    throw error
  }
}

/** Deletes an image, unless a pet, page or the site logo still uses it. */
export async function removeUpload(id: number): Promise<void> {
  // Get the storage first: a bad storage setup should fail before the row is gone, not after.
  const storage = await getStorage()
  const filename = await deleteMediaRow(id)
  await removeFiles(storage, [filename, thumbnailFilename(filename)])
}
