'use client'

import { usePathname } from 'next/navigation'
import { createSerializer, useQueryStates } from 'nuqs'
import React from 'react'

import { mediaSearchParsers } from '@/app/(admin)/admin/media/search-params'
import PetPagination from '@/components/admin/pets/PetPagination'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MEDIA_PAGE_SIZES } from '@/lib/admin/media-page'

// The media library's footer: "Showing 25–48 of 130", how many per page, and the pager. Both write
// the URL through nuqs (?page=, ?perPage=, shallow: the server is not asked), and the library
// reads it and fetches with SWR, like the pets list. The pager's links are real hrefs (they can
// be opened in a new tab). Changing the size keeps the first image you were looking at on screen.

const serialize = createSerializer(mediaSearchParsers)

export function MediaPager({ page, perPage, totalDocs, totalPages }: { page: number; perPage: number; totalDocs: number; totalPages: number }) {
  const pathname = usePathname()
  const [filters, setFilters] = useQueryStates(mediaSearchParsers)

  const first = totalDocs === 0 ? 0 : (page - 1) * perPage + 1
  const last = Math.min(page * perPage, totalDocs)

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <p aria-live="polite">{totalDocs === 0 ? 'No images' : `Showing ${first}–${last} of ${totalDocs}`}</p>
        <div className="flex items-center gap-2">
          <label htmlFor="media-per-page">Per page</label>
          <Select
            items={MEDIA_PAGE_SIZES.options.map((size) => ({ value: String(size), label: String(size) }))}
            value={String(perPage)}
            onValueChange={(value) => {
              const size = Number(value) as (typeof MEDIA_PAGE_SIZES.options)[number]
              if (!size || size === perPage) return
              // Stay on the page that holds the first image shown now.
              setFilters({ perPage: size, page: Math.floor(((page - 1) * perPage) / size) + 1 })
            }}
          >
            <SelectTrigger id="media-per-page" size="sm" className="w-20 text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEDIA_PAGE_SIZES.options.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <PetPagination
        page={page}
        totalPages={totalPages}
        hrefFor={(target) => pathname + serialize({ ...filters, page: target })}
        onPageChange={(target) => {
          setFilters({ page: target })
          window.scrollTo({ top: 0 })
        }}
      />
    </div>
  )
}
