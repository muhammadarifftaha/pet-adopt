import type { MetadataRoute } from 'next'

import { siteUrl } from '@/lib/shared'

/**
 * Everything may be indexed except the search endpoint. The Markdown copies (`/llms.txt`,
 * `/docs/<page>.md`) stay open on purpose: they are there for AI tools. Vercel's preview
 * deployments send their own `X-Robots-Tag: noindex`, so only the production site is indexed.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  }
}
