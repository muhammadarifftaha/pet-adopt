import sharp from 'sharp'

import { emailImageFilename, SAFE_EMAIL_IMAGE } from '@/server/media-url'
import { logError } from '@/server/result'
import { getStorage } from '@/server/storage'

export const dynamic = 'force-dynamic'

// /media/email/<name>.png: a WebP upload as PNG, for emails (classic Outlook and some older clients
// cannot show WebP; src/lib/email-template.ts links WebP images here). Lossless, so nothing is lost
// from the picture; animated images keep their first frame. Made on the first request and kept in
// storage as <name>.email.png, which the upload's removal deletes too. Only WebP uploads are served.

const NOT_FOUND = { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } }

function png(body: Uint8Array) {
  return new Response(new Uint8Array(body.buffer, body.byteOffset, body.byteLength), {
    headers: {
      'Content-Type': 'image/png',
      // The upload's name never changes, so neither does this.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  })
}

/** Conversions under way, by the name of the copy being made. */
const converting = new Map<string, Promise<Buffer>>()

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  if (!SAFE_EMAIL_IMAGE.test(name)) return new Response('Not found', NOT_FOUND)
  const original = name.replace(/\.png$/, '.webp')
  const copy = emailImageFilename(original)

  try {
    const storage = await getStorage()
    const cached = await storage.get(copy)
    if (cached) return png(cached.body)
    const file = await storage.get(original)
    if (!file) return new Response('Not found', NOT_FOUND)
    // Anyone can ask for this address, and converting a large picture is slow: requests that arrive
    // while one is being made wait for it instead of each starting their own.
    let making = converting.get(copy)
    if (!making) {
      making = (async () => {
        const converted = await sharp(file.body, { animated: false }).png({ compressionLevel: 9 }).toBuffer()
        // Kept for next time; if that fails, these requests still get their image.
        await storage.put(copy, converted, 'image/png').catch((error) => logError(error, `could not keep ${copy}`))
        return converted
      })().finally(() => converting.delete(copy))
      converting.set(copy, making)
    }
    return png(await making)
  } catch (error) {
    logError(error, `could not serve /media/email/${name}`)
    return new Response('Image unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
