import type { Metadata } from 'next'
import Link from 'next/link'
import React from 'react'

import { PetCard } from '@/components/site/PetCard'
import { AGE_GROUPS, isPetStatus, labelFor, normalizeSpecies, PetStatus, SEXES, SIZES, SPECIES, STATUSES } from '@/lib/options'
import { getSpeciesOptions, PAGE_SIZE, queryPets, toPetCard } from '@/lib/queries'

export const metadata: Metadata = {
  title: 'Adoptable pets',
  description: 'Browse the pets currently looking for a home.',
}

type SearchParams = Record<string, string | string[] | undefined>

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

const oneOf = (value: string | undefined, options: readonly { value: string }[]) =>
  value && options.some((o) => o.value === value) ? value : ''

function FilterSelect({
  name,
  label,
  value,
  options,
  anyLabel,
}: {
  name: string
  label: string
  value: string
  options: readonly { label: string; value: string }[]
  anyLabel: string
}) {
  return (
    <label className="filter">
      <span>{label}</span>
      <select name={name} defaultValue={value}>
        <option value="">{anyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export default async function PetsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams

  // Species is free text (owners can add their own), so there is no fixed list to check against.
  const species = normalizeSpecies(first(params.species))
  const sex = oneOf(first(params.sex), SEXES)
  const ageGroup = oneOf(first(params.ageGroup), AGE_GROUPS)
  const size = oneOf(first(params.size), SIZES)
  const location = (first(params.location) ?? '').trim().slice(0, 80)
  // No status in the URL means "available"; an empty status means "any".
  const rawStatus = first(params.status)
  const status = rawStatus === undefined ? PetStatus.Available : oneOf(rawStatus, STATUSES)
  const page = Math.max(1, Number.parseInt(first(params.page) ?? '1', 10) || 1)

  const [result, speciesChoices] = await Promise.all([
    queryPets({ species, sex, ageGroup, size, status: isPetStatus(status) ? status : undefined, location, page, limit: PAGE_SIZE }),
    getSpeciesOptions(),
  ])
  const pets = result.docs.map(toPetCard)
  // Keep the chosen species selectable even when no listed pet has it (a link to an empty species).
  const speciesFilterOptions =
    !species || speciesChoices.some((o) => o.value === species)
      ? speciesChoices
      : [...speciesChoices, { label: labelFor(SPECIES, species), value: species }]

  const linkFor = (target: number) => {
    const qs = new URLSearchParams()
    if (species) qs.set('species', species)
    if (sex) qs.set('sex', sex)
    if (ageGroup) qs.set('ageGroup', ageGroup)
    if (size) qs.set('size', size)
    if (location) qs.set('location', location)
    qs.set('status', status)
    if (target > 1) qs.set('page', String(target))
    return `/pets?${qs.toString()}`
  }

  return (
    <section className="section spacing-md">
      <div className="container">
        <h1 className="section-title">Adoptable pets</h1>

        {/* A plain GET form: filters live in the URL, so any search can be shared. */}
        <form className="filters" method="get" action="/pets">
          <FilterSelect name="species" label="Species" value={species} options={speciesFilterOptions} anyLabel="All" />
          <FilterSelect name="ageGroup" label="Age" value={ageGroup} options={AGE_GROUPS} anyLabel="Any" />
          <FilterSelect name="sex" label="Sex" value={sex} options={SEXES} anyLabel="Any" />
          <FilterSelect name="size" label="Size" value={size} options={SIZES} anyLabel="Any" />
          <FilterSelect name="status" label="Status" value={status} options={STATUSES} anyLabel="Any" />
          <label className="filter">
            <span>Location</span>
            <input type="search" name="location" defaultValue={location} placeholder="City or area" />
          </label>
          <button type="submit" className="btn btn-primary btn-small">
            Apply
          </button>
          <Link href="/pets" className="link-more">
            Reset
          </Link>
        </form>

        {pets.length ? (
          <div className="pet-grid">
            {pets.map((pet) => (
              <PetCard key={pet.id} pet={pet} />
            ))}
          </div>
        ) : (
          <p className="muted empty">No pets match these filters. Try widening your search.</p>
        )}

        {result.totalPages > 1 && (
          <nav className="pagination" aria-label="Pagination">
            {result.hasPrevPage ? <Link href={linkFor(page - 1)}>Previous</Link> : <span />}
            <span>
              Page {result.page} of {result.totalPages}
            </span>
            {result.hasNextPage ? <Link href={linkFor(page + 1)}>Next</Link> : <span />}
          </nav>
        )}
      </div>
    </section>
  )
}
