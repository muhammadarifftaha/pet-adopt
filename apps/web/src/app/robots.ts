import type { MetadataRoute } from 'next'

import { absoluteUrl, searchIndexingAllowed } from '@/lib/seo'

// /robots.txt: the public site is open to search engines, the team's screens are not (they also
// send noindex), and sitemap.xml is announced. A preview or staging copy (see seo.ts) asks every
// search engine to stay away entirely.
// Worked out per request, not at build time, so SEARCH_INDEXING set on a running server applies.
export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  if (!searchIndexingAllowed()) return { rules: { userAgent: '*', disallow: '/' } }
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/edit', '/api', '/setup'] },
    sitemap: absoluteUrl('/sitemap.xml'),
  }
}
