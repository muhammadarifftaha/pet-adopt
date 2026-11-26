// Profile pictures (agreed with the owner): each person uploads their own on the Account page, picks
// a square with the crop tool, and the server keeps only that square at AVATAR_SIZE px (WebP, no
// metadata; the original is not kept). They are not in the Media library. Admins can remove someone's
// picture (Users) but not upload one for them. Someone with no picture who connects a sign-in
// provider gets the provider's picture (from its verified ID token), copied here the same way.
//
// Files are `avatar-<32 hex>.webp` in the uploads bucket, served by /media like uploads (names are
// random); `users.image` holds the /media address. Replacing or removing one deletes the old file,
// and so does deleting the account.
import { randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { eq } from 'drizzle-orm'
import sharp, { type Metadata } from 'sharp'

import { getDatabase } from '@/db/client'

import { MEDIA_PATH, mediaUrl } from './media-url'
import { logError, ValidationError } from './result'
import { getStorage } from './storage'

export const AVATAR_SIZE = 256
const MAX_BYTES = 10_000_000
const MAX_PIXELS = 40_000_000
const MAX_SIDE = 12_000
const FORMATS = new Set(['jpeg', 'png', 'webp', 'gif'])
const AVATAR_NAME = /^avatar-[a-f0-9]{32}\.webp$/

/** The square to keep, in pixels of the (upright) picture: left, top and side. */
export type Crop = { x: number; y: number; size: number }

/** Reads and checks an image like any upload: JPEG, PNG, WebP or GIF, at most 10 MB and 40 megapixels. */
async function readImage(data: Buffer): Promise<{ meta: Metadata; width: number; height: number }> {
  if (!data.length) throw new ValidationError({ file: 'Choose a picture.' })
  if (data.length > MAX_BYTES) throw new ValidationError({ file: 'The picture is larger than 10 MB.' })
  let meta: Metadata
  try {
    meta = await sharp(data, { limitInputPixels: MAX_PIXELS }).metadata()
  } catch {
    throw new ValidationError({ file: 'This file is not a readable picture, or it is too large.' })
  }
  if (!meta.format || !FORMATS.has(meta.format)) {
    throw new ValidationError({ file: meta.format === 'heif' ? 'AVIF and HEIC pictures are not accepted. Use a JPEG, PNG or WebP.' : 'Use a JPEG, PNG, WebP or GIF picture.' })
  }
  if (!meta.width || !meta.height || meta.width > MAX_SIDE || meta.height > MAX_SIDE) throw new ValidationError({ file: 'The picture is too large.' })
  // The crop is chosen on the picture as the browser shows it: upright, after the EXIF orientation.
  const turned = (meta.orientation ?? 1) >= 5
  return { meta, width: turned ? meta.height : meta.width, height: turned ? meta.width : meta.height }
}

/** A crop inside the picture, whole pixels, at least 16 px. Out-of-range values are refused, not clamped. */
function checkCrop(raw: unknown, width: number, height: number): Crop {
  const { x, y, size } = (raw ?? {}) as Record<string, unknown>
  const whole = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) ? value : NaN)
  const crop = { x: whole(x), y: whole(y), size: whole(size) }
  if (![crop.x, crop.y, crop.size].every(Number.isFinite) || crop.x < 0 || crop.y < 0 || crop.size < 16 || crop.x + crop.size > width || crop.y + crop.size > height) {
    throw new ValidationError({ crop: 'Pick the part of the picture to use again.' })
  }
  return crop
}

/** The centre square of a picture (for provider pictures, which come without a crop). */
const centre = (width: number, height: number): Crop => {
  const size = Math.min(width, height)
  return { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size }
}

/** Cuts the square out of the upright first frame and makes the small WebP (no metadata). */
async function render(data: Buffer, crop: Crop): Promise<Buffer> {
  return sharp(data, { limitInputPixels: MAX_PIXELS, pages: 1 })
    .rotate()
    .extract({ left: crop.x, top: crop.y, width: crop.size, height: crop.size })
    .resize(AVATAR_SIZE, AVATAR_SIZE)
    .webp({ quality: 85 })
    .toBuffer()
}

const fileOf = (image: string | null | undefined): string | null => {
  const name = image?.startsWith(MEDIA_PATH) ? image.slice(MEDIA_PATH.length) : null
  return name && AVATAR_NAME.test(name) ? name : null
}

/** Deletes a stored avatar file; logs (never throws) when it cannot. */
export async function deleteAvatarFile(image: string | null | undefined): Promise<void> {
  const name = fileOf(image)
  if (!name) return
  try {
    await (await getStorage()).delete(name)
  } catch (error) {
    logError(error, `could not delete the profile picture ${name}`)
  }
}

async function store(userId: string, picture: Buffer): Promise<string> {
  const name = `avatar-${randomBytes(16).toString('hex')}.webp`
  await (await getStorage()).put(name, picture, 'image/webp')
  const { db, t } = await getDatabase()
  const [before] = await db.select({ image: t.users.image }).from(t.users).where(eq(t.users.id, userId)).limit(1)
  const url = mediaUrl(name)
  await db.update(t.users).set({ image: url, updatedAt: new Date() }).where(eq(t.users.id, userId))
  await deleteAvatarFile(before?.image)
  return url
}

/** Saves an uploaded picture, cropped to `crop`, as the person's avatar. Returns its address. */
export async function saveAvatar(userId: string, data: Buffer, crop: unknown): Promise<string> {
  const { width, height } = await readImage(data)
  return store(userId, await render(data, checkCrop(crop, width, height)))
}

/** Removes a person's picture (they go back to their initials). */
export async function removeAvatar(userId: string): Promise<boolean> {
  const { db, t } = await getDatabase()
  const [user] = await db.select({ image: t.users.image }).from(t.users).where(eq(t.users.id, userId)).limit(1)
  if (!user?.image) return false
  await db.update(t.users).set({ image: null, updatedAt: new Date() }).where(eq(t.users.id, userId))
  await deleteAvatarFile(user.image)
  return true
}

// --- A sign-in provider's picture ----------------------------------------------------------------

/** True for addresses that are not on the public internet (loopback, private, link-local...). */
export function isPrivateAddress(address: string): boolean {
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  }
  const v6 = address.toLowerCase()
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff')
}

/**
 * Downloads a picture from a provider's profile, carefully: https only, a public host (the address
 * comes from whoever owns the provider account), no redirects, 5 seconds, 5 MB. Null when unsuitable.
 */
async function download(url: string): Promise<Buffer | null> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
  const addresses = await lookup(parsed.hostname, { all: true }).catch(() => [])
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) return null
  const response = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(5000) }).catch(() => null)
  if (!response?.ok || !response.body) return null
  const limit = 5_000_000
  if (Number(response.headers.get('content-length') ?? 0) > limit) return null
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length
    if (total > limit) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** The `picture` claim of an ID token (already verified by Better Auth when the account was linked). */
export function pictureFromIdToken(idToken: string | null | undefined): string | null {
  const payload = idToken?.split('.')[1]
  if (!payload) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { picture?: unknown }
    return typeof claims.picture === 'string' ? claims.picture : null
  } catch {
    return null
  }
}

/**
 * Uses a provider's picture as the avatar of someone who has none (agreed with the owner), centre
 * cropped. Never throws: a picture that cannot be fetched or read is simply not used.
 * `fetchPicture` is for the checks.
 */
export async function adoptProviderPicture(userId: string, url: string | null, fetchPicture: (url: string) => Promise<Buffer | null> = download): Promise<boolean> {
  if (!url) return false
  try {
    const { db, t } = await getDatabase()
    const [user] = await db.select({ image: t.users.image }).from(t.users).where(eq(t.users.id, userId)).limit(1)
    if (!user || user.image) return false
    const data = await fetchPicture(url)
    if (!data) return false
    const { width, height } = await readImage(data)
    await store(userId, await render(data, centre(width, height)))
    return true
  } catch (error) {
    if (!(error instanceof ValidationError)) logError(error, 'could not use the provider picture')
    return false
  }
}
