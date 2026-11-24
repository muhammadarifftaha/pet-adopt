import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import React from 'react'

import { RichText } from '@/components/site/RichText'
import { WhatsAppButton } from '@/components/site/WhatsAppButton'
import { AGE_GROUPS, SEXES, SIZES, SPECIES, STATUSES, labelFor } from '@/lib/options'
import { petSeo } from '@/lib/pet-seo'
import { getPetBySlug, getSettings, mediaOf } from '@/lib/queries'
import { fillMessage } from '@/lib/whatsapp'

export const revalidate = 60

// Pet pages are rendered on first visit, then cached.
export function generateStaticParams() {
  return []
}

type Args = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Args): Promise<Metadata> {
  const { slug } = await params
  const pet = await getPetBySlug(slug)
  if (!pet) return {}
  const cover = mediaOf(pet.photos?.[0])
  // Owners can override the search and share text per pet (SEO tab); otherwise build it.
  const shareImage = mediaOf(pet.seo?.image) ?? cover
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
  return {
    title,
    description,
    openGraph: { title, description, images: shareImage ? [shareImage.url] : undefined },
    // Unlisted pets are for people with the link, not for search engines.
    robots: pet.unlisted ? { index: false, follow: false } : undefined,
  }
}

export default async function PetPage({ params }: Args) {
  const { slug } = await params
  const [pet, settings] = await Promise.all([getPetBySlug(slug), getSettings()])
  if (!pet) notFound()

  const photos = pet.photos.map(mediaOf).filter((m): m is NonNullable<ReturnType<typeof mediaOf>> => Boolean(m))
  const adopted = pet.status === 'adopted'

  const facts: [string, string | null | undefined][] = [
    ['Species', labelFor(SPECIES, pet.species)],
    ['Breed', pet.breed],
    ['Sex', pet.sex && pet.sex !== 'unknown' ? labelFor(SEXES, pet.sex) : null],
    ['Age', pet.ageDescription || (pet.ageGroup ? labelFor(AGE_GROUPS, pet.ageGroup) : null)],
    ['Size', pet.size ? labelFor(SIZES, pet.size) : null],
    ['Location', pet.location],
    ['Vaccinated', pet.vaccinated ? 'Yes' : null],
    ['Neutered / spayed', pet.neutered ? 'Yes' : null],
  ]

  return (
    <section className="section spacing-md">
      <div className="container">
        <Link href="/pets" className="link-more">
          ← All pets
        </Link>

        <div className="pet-detail">
          <div className="pet-gallery">
            {photos.map((photo, i) => (
              <div key={photo.url} className={i === 0 ? 'pet-photo pet-photo-main' : 'pet-photo'}>
                <Image src={photo.url} alt={photo.alt || `${pet.name} photo ${i + 1}`} fill priority={i === 0} sizes={i === 0 ? '(max-width: 900px) 100vw, 60vw' : '30vw'} />
              </div>
            ))}
          </div>

          <div className="pet-info">
            <div className="pet-title">
              <h1>{pet.name}</h1>
              <span className={`badge badge-${pet.status}`}>{labelFor(STATUSES, pet.status)}</span>
            </div>

            <dl className="facts">
              {facts
                .filter(([, value]) => Boolean(value))
                .map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
            </dl>

            {/* A rich-text document drawn as React elements (never HTML), so it cannot inject markup. */}
            <RichText doc={pet.description} className="prose" />

            {adopted ? (
              <p className="notice">{pet.name} has found a home. Message us to hear about similar pets.</p>
            ) : null}

            <WhatsAppButton
              phone={settings.whatsappNumber}
              message={adopted ? fillMessage('Hi! I saw {pet} was adopted. Do you have similar pets?', pet.name) : fillMessage(settings.whatsappMessage, pet.name)}
              label={adopted ? 'Ask about similar pets' : `Ask about ${pet.name} on WhatsApp`}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
