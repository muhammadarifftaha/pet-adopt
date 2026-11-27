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
import { get as httpsGet } from 'node:https'
import { BlockList, isIP } from 'node:net'

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

// Addresses that are not on the public internet. An IPv4 address written as IPv6 ("::ffff:10.0.0.1",
// also in its hex form "::ffff:a00:1") is checked against the IPv4 rules by BlockList itself.
const notPublic = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata services live here)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 3], // multicast and reserved
] as const) {
  notPublic.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 96], // unspecified, loopback and the old IPv4-compatible form
  ['64:ff9b::', 96], // NAT64: an IPv4 address behind a translator
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4: carries an IPv4 address
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const) {
  notPublic.addSubnet(network, prefix, 'ipv6')
}

/** True for addresses that are not on the public internet (loopback, private, link-local...), and for anything that is not an address. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return true
  return notPublic.check(address, family === 4 ? 'ipv4' : 'ipv6')
}

const DOWNLOAD_LIMIT = 5_000_000
const DOWNLOAD_MS = 5000

/**
 * Downloads a picture from a provider's profile, carefully: https only, a public host (the address
 * comes from whoever owns the provider account), no redirects, 5 seconds, 5 MB. Null when unsuitable.
 *
 * The host name is resolved once, every address it has must be public, and the connection is then
 * made to that checked address (the certificate is still verified against the name). Resolving
 * again for the connection would let a name answer "public" for the check and "internal" a moment
 * later.
 */
async function download(url: string): Promise<Buffer | null> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
  const addresses = await lookup(parsed.hostname.replace(/^\[|\]$/g, ''), { all: true }).catch(() => [])
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) return null
  const [target] = addresses

  return new Promise<Buffer | null>((resolve) => {
    let settled = false
    const finish = (result: Buffer | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      request.destroy()
      resolve(result)
    }
    const request = httpsGet(
      parsed,
      {
        // Connect to the address that was checked, whatever the name resolves to by now.
        lookup: (_host, options, callback) => {
          const all = typeof options === 'object' && options !== null && (options as { all?: boolean }).all
          if (all) (callback as unknown as (error: null, list: Array<{ address: string; family: number }>) => void)(null, [target])
          else callback(null, target.address, target.family)
        },
        // The same plain client name Node's own fetch sends; some hosts refuse a request without one.
        headers: { accept: 'image/*', 'user-agent': 'node' },
      },
      (response) => {
        // No redirects: 3xx is simply not a picture.
        if (response.statusCode !== 200) return finish(null)
        if (Number(response.headers['content-length'] ?? 0) > DOWNLOAD_LIMIT) return finish(null)
        const chunks: Buffer[] = []
        let total = 0
        response.on('data', (chunk: Buffer) => {
          total += chunk.length
          if (total > DOWNLOAD_LIMIT) return finish(null)
          chunks.push(chunk)
        })
        response.on('end', () => finish(Buffer.concat(chunks)))
        response.on('error', () => finish(null))
      },
    )
    request.on('error', () => finish(null))
    // One limit for the whole download, not per step.
    const timer = setTimeout(() => finish(null), DOWNLOAD_MS)
  })
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
