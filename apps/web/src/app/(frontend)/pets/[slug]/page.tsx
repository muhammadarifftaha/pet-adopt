import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import React from 'react'

import { BuilderContent } from '@/components/site/BuilderContent'
import { SPECIES, labelFor } from '@/lib/options'
import { petSeo } from '@/lib/pet-seo'
import { getPetBySlug, getPetPage, getPublishedPage, getSettings } from '@/lib/queries'
import { jsonLd, pageMetadata, petBreadcrumbsLd } from '@/lib/seo'
import { DEFAULT_PET_PAGE_DATA, isPuckData, PET_PAGE_SLUG } from '@/puck/data'

export const revalidate = 60

// Pet pages are rendered on first visit, then cached.
export function generateStaticParams() {
  return []
}

type Args = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Args): Promise<Metadata> {
  const { slug } = await params
  const [pet, settings] = await Promise.all([getPetBySlug(slug), getSettings()])
  if (!pet) return {}
  // Owners can override the search and share text and image per pet (SEO tab); otherwise build them.
  const image = pet.seo?.image ?? pet.photos?.[0] ?? null
  // The same fallbacks the admin's "Search and sharing" preview shows (src/lib/pet-seo.ts).
  const { title, description } = petSeo({
    name: pet.name,
    status: pet.status,
    speciesLabel: labelFor(SPECIES, pet.species),
    breed: pet.breed,
    ageDescription: pet.ageDescription,
    location: pet.location,
    seoTitle: pet.seo?.title,
    seoDescription: pet.seo?.description,
  })
  return pageMetadata({
    path: `/pets/${pet.slug}`,
    siteName: settings.siteName,
    title,
    description,
    image,
    // Unlisted pets are for people with the link, not for search engines.
    robots: pet.unlisted ? 'noindex' : 'index',
  })
}

// A pet's page: the Pet page template (system page "pet-page", edited in the page builder with the
// pet blocks, src/puck/pet-page-config.tsx) drawn for this pet; its built-in layout until the owners
// publish one. The status notice is automatic, not a block (agreed with the owner).
export default async function PetPage({ params }: Args) {
  const { slug } = await params
  const [pet, template, petsPage] = await Promise.all([getPetPage(slug), getPublishedPage(PET_PAGE_SLUG), getPublishedPage('pets')])
  if (!pet) notFound()
  const data = template && isPuckData(template.puckData) ? template.puckData : DEFAULT_PET_PAGE_DATA

  return (
    <>
      {/* Structured data (JSON, not run as a script): Home › Pets › this pet in search results. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(petBreadcrumbsLd(petsPage?.title || 'Adoptable pets', pet)) }} />
      <div className="container pet-page-top">
        <Link href="/pets" className="link-more">
          ← All pets
        </Link>
        {pet.status === 'adopted' ? (
          <p className="notice pet-status-notice">{pet.name} has found a home. Have a look at the other pets below.</p>
        ) : pet.status === 'pending' ? (
          <p className="notice pet-status-notice">{pet.name}’s adoption is pending. Message us if you are interested: plans sometimes change.</p>
        ) : null}
      </div>
      <BuilderContent data={data} title={pet.name} pet={pet} />
    </>
  )
}
