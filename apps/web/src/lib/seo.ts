// Search and sharing, shared by the public pages' metadata, sitemap.xml and robots.txt (agreed with
// the owner): canonical addresses, share images with their size, structured data (schema.org
// JSON-LD), and whether search engines may index this copy of the site at all.
import type { Metadata } from 'next'

import type { MediaItem } from '@/server/types'

/** The site's own address (production requires NEXT_PUBLIC_SERVER_URL; see instrumentation.ts). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/, '')

/** A site path as a full address, for sitemap.xml, robots.txt and structured data. */
export const absoluteUrl = (path: string) => (/^https?:\/\//.test(path) ? path : `${SITE_URL}${path.startsWith('/') ? '' : '/'}${path}`)

/**
 * Whether search engines may index this copy of the site: not on a Vercel preview (VERCEL_ENV other
 * than `production`) and not when SEARCH_INDEXING=off (a staging server). Production is indexed.
 */
export function searchIndexingAllowed(env: Record<string, string | undefined> = process.env): boolean {
  if ((env.SEARCH_INDEXING ?? '').trim().toLowerCase() === 'off') return false
  if (env.VERCEL_ENV && env.VERCEL_ENV !== 'production') return false
  return true
}

/** An uploaded image as a share image (Open Graph), with its size and alt text when known. */
export function shareImage(image: Pick<MediaItem, 'url' | 'alt' | 'width' | 'height'> | null | undefined) {
  if (!image?.url) return undefined
  return [{ url: image.url, ...(image.width ? { width: image.width } : {}), ...(image.height ? { height: image.height } : {}), ...(image.alt ? { alt: image.alt } : {}) }]
}

/** `robots` for a page: never indexed while this copy of the site is not (see searchIndexingAllowed). */
export function robotsFor(page: 'index' | 'noindex' | 'noindex-follow' = 'index'): Metadata['robots'] {
  if (!searchIndexingAllowed() || page === 'noindex') return { index: false, follow: false }
  if (page === 'noindex-follow') return { index: false, follow: true }
  return undefined
}

/**
 * The search and sharing metadata every public page has: its canonical address (also the share
 * card's address), title and description for sharing, a large-image card when there is an image,
 * and `robots`. Next merges a page's metadata with the layout's one top-level key at a time, so the
 * share card repeats the site's name and `robots` always carries the "not this copy" rule.
 */
export function pageMetadata({
  path,
  siteName,
  title,
  description,
  image,
  robots = 'index',
  absoluteTitle = false,
}: {
  path: string
  siteName: string
  title?: string
  description?: string | null
  image?: Pick<MediaItem, 'url' | 'alt' | 'width' | 'height'> | null
  robots?: 'index' | 'noindex' | 'noindex-follow'
  /** The title as it is, without the layout's "| Site name" (the homepage). */
  absoluteTitle?: boolean
}): Metadata {
  const images = shareImage(image)
  const text = { ...(title ? { title } : {}), ...(description ? { description } : {}) }
  const rules = robotsFor(robots)
  return {
    ...text,
    ...(title && absoluteTitle ? { title: { absolute: title } } : {}),
    alternates: { canonical: path },
    openGraph: { type: 'website', siteName, url: path, ...text, ...(images ? { images } : {}) },
    twitter: { card: images ? 'summary_large_image' : 'summary', ...text, ...(images ? { images: images.map((i) => i.url) } : {}) },
    ...(rules ? { robots: rules } : {}),
  }
}

/** Structured data as a script tag's text: JSON with `<` escaped so it can never close the tag. */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c')

/**
 * The organisation behind the site and the site itself, for the homepage (schema.org Organization
 * and WebSite): name, address, logo, description, WhatsApp number, street address and social
 * profiles, as set in Site settings.
 */
export function organizationLd(settings: {
  siteName: string
  tagline?: string | null
  logo?: { url?: string | null } | null
  whatsappNumber?: string | null
  address?: string | null
  socials?: Array<{ url: string }>
}) {
  const organization = {
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: settings.siteName,
    url: `${SITE_URL}/`,
    ...(settings.logo?.url ? { logo: absoluteUrl(settings.logo.url) } : {}),
    ...(settings.tagline ? { description: settings.tagline } : {}),
    ...(settings.whatsappNumber ? { contactPoint: { '@type': 'ContactPoint', telephone: settings.whatsappNumber, contactType: 'adoption enquiries' } } : {}),
    ...(settings.address ? { address: settings.address } : {}),
    ...(settings.socials?.length ? { sameAs: settings.socials.map((social) => social.url) } : {}),
  }
  const website = { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, name: settings.siteName, url: `${SITE_URL}/`, publisher: { '@id': organization['@id'] } }
  return { '@context': 'https://schema.org', '@graph': [organization, website] }
}

/** The trail Home › Pets › <pet> for a pet's page (schema.org BreadcrumbList). */
export function petBreadcrumbsLd(petsTitle: string, pet: { name: string; slug: string }) {
  const items = [
    { name: 'Home', path: '/' },
    { name: petsTitle, path: '/pets' },
    { name: pet.name, path: `/pets/${pet.slug}` },
  ]
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, name: item.name, item: absoluteUrl(item.path) })),
  }
}
