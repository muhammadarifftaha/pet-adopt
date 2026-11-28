// sitemap.xml (agreed with the owner): what search engines should find. The homepage and the Pets
// page, every live page of the owners' own (not archived; never the Pet page template, which has no
// address), and every listed pet that is not adopted, with its main photo for image search. Adopted
// pets stay out (searches should favour pets that can be adopted) but their pages stay indexable.
// Unlisted pets are link-only and never listed.
import { and, asc, eq, isNull, ne, notInArray } from 'drizzle-orm'
import type { MetadataRoute } from 'next'

import { getDatabase } from '@/db/client'
import { PetStatus } from '@/lib/options'
import { absoluteUrl } from '@/lib/seo'
import { PET_PAGE_SLUG } from '@/puck/data'

import { mediaUrl } from './media-url'

/** A sitemap file may list at most this many addresses. */
const MAX_URLS = 50_000

export async function sitemapEntries(): Promise<MetadataRoute.Sitemap> {
  const { db, t } = await getDatabase()
  const [pages, pets] = await Promise.all([
    db
      .select({ slug: t.pages.slug, publishedAt: t.pages.publishedAt, updatedAt: t.pages.updatedAt })
      .from(t.pages)
      .where(and(eq(t.pages.status, 'published'), isNull(t.pages.archivedAt), notInArray(t.pages.slug, [PET_PAGE_SLUG])))
      .orderBy(asc(t.pages.slug)),
    // Each pet with its main photo (position 0), if it has one.
    db
      .select({ slug: t.pets.slug, updatedAt: t.pets.updatedAt, photo: t.media.filename })
      .from(t.pets)
      .leftJoin(t.petPhotos, and(eq(t.petPhotos.petId, t.pets.id), eq(t.petPhotos.position, 0)))
      .leftJoin(t.media, eq(t.media.id, t.petPhotos.mediaId))
      .where(and(eq(t.pets.unlisted, false), ne(t.pets.status, PetStatus.Adopted)))
      .orderBy(asc(t.pets.slug))
      .limit(MAX_URLS),
  ])

  const byPath = new Map(pages.map((page) => [page.slug, page]))
  const lastOf = (page: { publishedAt: Date | null; updatedAt: Date } | undefined) => page?.publishedAt ?? page?.updatedAt
  const home = byPath.get('home')
  const petsPage = byPath.get('pets')
  const entries: MetadataRoute.Sitemap = [
    // The homepage and the Pets page always exist (their built-in layouts while unpublished).
    { url: absoluteUrl('/'), ...(lastOf(home) ? { lastModified: lastOf(home) } : {}), changeFrequency: 'weekly', priority: 1 },
    { url: absoluteUrl('/pets'), ...(lastOf(petsPage) ? { lastModified: lastOf(petsPage) } : {}), changeFrequency: 'daily', priority: 0.9 },
    ...pages
      .filter((page) => page.slug !== 'home' && page.slug !== 'pets')
      .map((page) => ({ url: absoluteUrl(`/${page.slug}`), lastModified: lastOf(page), changeFrequency: 'monthly' as const, priority: 0.5 })),
    ...pets.map((pet) => ({
      url: absoluteUrl(`/pets/${pet.slug}`),
      lastModified: pet.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
      ...(pet.photo ? { images: [absoluteUrl(mediaUrl(pet.photo))] } : {}),
    })),
  ]
  return entries.slice(0, MAX_URLS)
}
