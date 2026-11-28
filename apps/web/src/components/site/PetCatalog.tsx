import Link from 'next/link'
import React from 'react'

import { PetCard } from '@/components/site/PetCard'
import { AGE_GROUPS, SEXES, SIZES, STATUSES } from '@/lib/options'
import type { CatalogData } from '@/lib/queries'

// The pet catalogue: a filter form, one page of matching pets and Previous / Next links. Used by
// the Pet catalogue block on the Pets page. No hooks (blocks render on the server and in the
// editor), and the filters are a plain GET form to /pets, so every search lives in the URL and
// works without JavaScript.

export const CATALOG_PATH = '/pets'

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

export function PetCatalog({
  catalog,
  showFilters = true,
  cardHeading = 'h3',
}: {
  catalog: CatalogData
  showFilters?: boolean
  /** The pets' names are one level below the block's heading. */
  cardHeading?: 'h2' | 'h3'
}) {
  const { pets, filters, page, totalPages, hasPrevPage, hasNextPage, speciesOptions } = catalog

  const linkFor = (target: number) => {
    const qs = new URLSearchParams()
    for (const key of ['species', 'sex', 'ageGroup', 'size', 'location'] as const) if (filters[key]) qs.set(key, filters[key])
    qs.set('status', filters.status)
    if (target > 1) qs.set('page', String(target))
    return `${CATALOG_PATH}?${qs.toString()}`
  }

  return (
    <>
      {showFilters ? (
        <form className="filters" method="get" action={CATALOG_PATH}>
          <FilterSelect name="species" label="Species" value={filters.species} options={speciesOptions} anyLabel="All" />
          <FilterSelect name="ageGroup" label="Age" value={filters.ageGroup} options={AGE_GROUPS} anyLabel="Any" />
          <FilterSelect name="sex" label="Sex" value={filters.sex} options={SEXES} anyLabel="Any" />
          <FilterSelect name="size" label="Size" value={filters.size} options={SIZES} anyLabel="Any" />
          <FilterSelect name="status" label="Status" value={filters.status} options={STATUSES} anyLabel="Any" />
          <label className="filter">
            <span>Location</span>
            <input type="search" name="location" defaultValue={filters.location} placeholder="City or area" />
          </label>
          <button type="submit" className="btn btn-primary btn-small">
            Apply
          </button>
          <Link href={CATALOG_PATH} className="link-more">
            Reset
          </Link>
        </form>
      ) : null}

      {pets.length ? (
        <div className="pet-grid">
          {pets.map((pet) => (
            <PetCard key={pet.id} pet={pet} headingLevel={cardHeading} />
          ))}
        </div>
      ) : (
        <p className="muted empty">No pets match these filters. Try widening your search.</p>
      )}

      {totalPages > 1 && (
        <nav className="pagination" aria-label="Pagination">
          {hasPrevPage ? <Link href={linkFor(page - 1)}>Previous</Link> : <span />}
          <span aria-current="page">
            Page {page} of {totalPages}
          </span>
          {hasNextPage ? <Link href={linkFor(page + 1)}>Next</Link> : <span />}
        </nav>
      )}
    </>
  )
}
