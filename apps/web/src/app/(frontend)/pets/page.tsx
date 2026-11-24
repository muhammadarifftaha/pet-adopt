import type { Metadata } from 'next'
import React from 'react'

import { BuilderContent } from '@/components/site/BuilderContent'
import { getPublishedPage, mediaOf, type CatalogParams } from '@/lib/queries'
import { DEFAULT_PETS_DATA, isPuckData } from '@/puck/data'

// The Pets page is a builder page (slug "pets", always id 2): owners can put anything around the
// Pet catalogue block. Until they publish one, the built-in layout (just the catalogue) is shown.
// The query string (filters, page) is handed to the blocks; that also makes this page dynamic.

const DEFAULT_TITLE = 'Adoptable pets'
const DEFAULT_DESCRIPTION = 'Browse the pets currently looking for a home.'

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPublishedPage('pets')
  const image = mediaOf(page?.seo?.image)
  const title = page?.title || DEFAULT_TITLE
  const description = page?.seo?.description || DEFAULT_DESCRIPTION
  return { title, description, openGraph: { title, description, images: image ? [image.url] : undefined } }
}

export default async function PetsPage({ searchParams }: { searchParams: Promise<CatalogParams> }) {
  const [page, params] = await Promise.all([getPublishedPage('pets'), searchParams])
  const data = page && isPuckData(page.puckData) ? page.puckData : DEFAULT_PETS_DATA
  return <BuilderContent data={data} title={page?.title || DEFAULT_TITLE} searchParams={params} />
}
