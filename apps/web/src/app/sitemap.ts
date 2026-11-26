import type { MetadataRoute } from 'next'

import { searchIndexingAllowed } from '@/lib/seo'
import { logError } from '@/server/result'
import { sitemapEntries } from '@/server/sitemap'

// /sitemap.xml (src/server/sitemap.ts decides what is in it). Refreshed at most every 10 minutes.
// Empty on a copy of the site that must not be indexed (a preview or staging, see seo.ts).
export const revalidate = 600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!searchIndexingAllowed()) return []
  try {
    return await sitemapEntries()
  } catch (error) {
    // No database during `next build`, or it is down: an empty sitemap now, a full one on the next refresh.
    if (process.env.NEXT_PHASE !== 'phase-production-build') logError(error, 'sitemap.xml')
    return []
  }
}
