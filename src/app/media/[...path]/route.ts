import { logError } from '@/server/result'
import { SAFE_FILENAME } from '@/server/media-url'
import { getStorage } from '@/server/storage'

export const dynamic = 'force-dynamic'

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
}

// Serves uploaded images from whichever storage is configured. File names are random and never
// change, so browsers and CDNs may keep them for a year.
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const name = path.length === 1 ? path[0] : ''
  // A short cache on "not found", so a CDN does not hammer the origin for an address that does not exist.
  if (!SAFE_FILENAME.test(name)) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } })

  let file
  try {
    file = await (await getStorage()).get(name)
  } catch (error) {
    // The storage is unreachable or misconfigured: that is a server problem, not a missing image,
    // and it must not be cached.
    logError(error, `could not read /media/${name}`)
    return new Response('Storage unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
  if (!file) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } })

  const ext = name.split('.').pop() as string
  // A view over the buffer, not a copy.
  return new Response(new Uint8Array(file.body.buffer, file.body.byteOffset, file.body.byteLength), {
    headers: {
      'Content-Type': TYPES[ext] ?? file.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      // An image should never run anything, even if opened directly.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  })
}
