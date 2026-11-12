import Image from 'next/image'
import Link from 'next/link'
import React from 'react'

import type { PetCardData } from '@/lib/queries'
import { SEXES, SPECIES, STATUSES, labelFor } from '@/lib/options'

export function PetCard({ pet }: { pet: PetCardData }) {
  const details = [labelFor(SPECIES, pet.species), pet.ageDescription, pet.sex && pet.sex !== 'unknown' ? labelFor(SEXES, pet.sex) : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <Link href={`/pets/${pet.slug}`} className="pet-card">
      <div className="pet-card-image">
        {pet.image ? (
          <Image src={pet.image.url} alt={pet.image.alt || pet.name} fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw" />
        ) : (
          <div className="pet-card-placeholder">No photo</div>
        )}
        {pet.status !== 'available' && <span className={`badge badge-${pet.status}`}>{labelFor(STATUSES, pet.status)}</span>}
      </div>
      <div className="pet-card-body">
        <h3>{pet.name}</h3>
        <p>{details}</p>
        {pet.location && <p className="muted">{pet.location}</p>}
      </div>
    </Link>
  )
}
