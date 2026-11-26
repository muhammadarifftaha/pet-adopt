import type { Metadata } from 'next'
import React from 'react'

import { BuilderContent } from '@/components/site/BuilderContent'
import { getPublishedPage, getSettings, type CatalogParams } from '@/lib/queries'
import { pageMetadata } from '@/lib/seo'
import { DEFAULT_PETS_DATA, isPuckData } from '@/puck/data'

// The Pets page is a builder page (slug "pets", always id 2): owners can put anything around the
// Pet catalogue block. Until they publish one, the built-in layout (just the catalogue) is shown.
// The query string (filters, page) is handed to the blocks; that also makes this page dynamic.

const DEFAULT_TITLE = 'Adoptable pets'
const DEFAULT_DESCRIPTION = 'Browse the pets currently looking for a home.'

// Filtered or paged catalogues (`?species=cat&page=3`) all point at /pets as their canonical address
// and are not indexed themselves (their links still are): every pet is in the sitemap anyway.
export async function generateMetadata({ searchParams }: { searchParams: Promise<CatalogParams> }): Promise<Metadata> {
  const [page, settings, params] = await Promise.all([getPublishedPage('pets'), getSettings(), searchParams])
  const filtered = Object.values(params).some((value) => (Array.isArray(value) ? value.some(Boolean) : Boolean(value)))
  return pageMetadata({
    path: '/pets',
    siteName: settings.siteName,
    title: page?.title || DEFAULT_TITLE,
    description: page?.seo?.description || DEFAULT_DESCRIPTION,
    image: page?.seo?.image,
    robots: filtered ? 'noindex-follow' : 'index',
  })
}

export default async function PetsPage({ searchParams }: { searchParams: Promise<CatalogParams> }) {
  const [page, params] = await Promise.all([getPublishedPage('pets'), searchParams])
  const data = page && isPuckData(page.puckData) ? page.puckData : DEFAULT_PETS_DATA
  return <BuilderContent data={data} title={page?.title || DEFAULT_TITLE} searchParams={params} />
}
