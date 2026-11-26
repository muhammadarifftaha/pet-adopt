import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'

import { BuilderContent } from '@/components/site/BuilderContent'
import { getPublishedPage, mediaOf } from '@/lib/queries'
import { isPuckData, PET_PAGE_SLUG } from '@/puck/data'

export const revalidate = 60

// Pages are rendered on first visit, then cached.
export function generateStaticParams() {
  return []
}

type Args = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Args): Promise<Metadata> {
  const { slug } = await params
  // The Pet page template draws /pets/<slug>; it has no address of its own.
  if (slug === PET_PAGE_SLUG) return {}
  const page = await getPublishedPage(slug)
  if (!page) return {}
  const image = mediaOf(page.seo?.image)
  return {
    title: page.title,
    description: page.seo?.description ?? undefined,
    openGraph: { title: page.title, description: page.seo?.description ?? undefined, images: image ? [image.url] : undefined },
  }
}

export default async function BuilderPage({ params }: Args) {
  const { slug } = await params
  if (slug === 'home') redirect('/')
  if (slug === PET_PAGE_SLUG) notFound()
  const page = await getPublishedPage(slug)
  if (!page || !isPuckData(page.puckData)) notFound()
  return <BuilderContent data={page.puckData} title={page.title} />
}
