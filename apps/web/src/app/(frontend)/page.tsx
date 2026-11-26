import type { Metadata } from 'next'
import React from 'react'

import { BuilderContent } from '@/components/site/BuilderContent'
import { getPublishedPage, getSettings } from '@/lib/queries'
import { jsonLd, organizationLd, pageMetadata } from '@/lib/seo'
import { DEFAULT_HOME_DATA, isPuckData } from '@/puck/data'

// Cached, and refreshed immediately when a page or pet is saved (see the collection hooks).
export const revalidate = 60

// The homepage's own search description and share image (Page settings), else the site's tagline;
// its title is the site's name as it is.
export async function generateMetadata(): Promise<Metadata> {
  const [page, settings] = await Promise.all([getPublishedPage('home'), getSettings()])
  return pageMetadata({
    path: '/',
    siteName: settings.siteName,
    title: settings.siteName,
    absoluteTitle: true,
    description: page?.seo?.description || settings.tagline,
    image: page?.seo?.image,
  })
}

export default async function HomePage() {
  const page = await getPublishedPage('home')
  const data = page && isPuckData(page.puckData) ? page.puckData : DEFAULT_HOME_DATA
  const settings = await getSettings()
  const title = page?.title ?? settings.siteName
  return (
    <>
      {/* Structured data (JSON, not run as a script): who runs the site, for search results. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(organizationLd(settings)) }} />
      <BuilderContent data={data} title={title} />
    </>
  )
}
