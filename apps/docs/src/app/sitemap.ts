import type { MetadataRoute } from 'next'

import { siteUrl } from '@/lib/shared'
import { source } from '@/lib/source'

/** The landing page and every docs page. Built with the site, like the pages. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteUrl, changeFrequency: 'monthly', priority: 1 },
    ...source.getPages().map((page) => ({ url: `${siteUrl}${page.url}`, changeFrequency: 'weekly' as const, priority: 0.7 })),
  ]
}
