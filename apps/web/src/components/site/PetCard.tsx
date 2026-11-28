import Image from 'next/image'
import Link from 'next/link'
import React from 'react'

import type { PetCardData } from '@/lib/queries'
import { SEXES, SPECIES, STATUSES, labelFor } from '@/lib/options'

/** `headingLevel`: the pet's name is one level below the section it sits in (h3 under an h2). */
export function PetCard({ pet, headingLevel: Name = 'h3' }: { pet: PetCardData; headingLevel?: 'h2' | 'h3' | 'h4' }) {
  const details = [labelFor(SPECIES, pet.species), pet.ageDescription, pet.sex && pet.sex !== 'unknown' ? labelFor(SEXES, pet.sex) : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <Link href={`/pets/${pet.slug}`} className="pet-card">
      <div className="pet-card-image">
        {/* The name is the card's heading: a photo without its own alt text adds nothing to the link. */}
        {pet.image ? (
          <Image src={pet.image.url} alt={pet.image.alt} fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw" />
        ) : (
          <div className="pet-card-placeholder">No photo</div>
        )}
        {pet.status !== 'available' && <span className={`badge badge-${pet.status}`}>{labelFor(STATUSES, pet.status)}</span>}
      </div>
      <div className="pet-card-body">
        <Name className="item-heading">{pet.name}</Name>
        <p>{details}</p>
        {pet.location && <p className="muted">{pet.location}</p>}
      </div>
    </Link>
  )
}
