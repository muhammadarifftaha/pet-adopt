'use client'

import { debounce, useQueryStates } from 'nuqs'
import React from 'react'
import { FiSearch } from 'react-icons/fi'

import { mediaSearchParsers } from '@/app/(admin)/admin/media/search-params'
import { EmptyState } from '@/components/admin/EmptyState'
import { MediaGrid } from '@/components/admin/MediaGrid'
import { MediaPager } from '@/components/admin/MediaPager'
import { UploadPhotosDialog } from '@/components/admin/UploadPhotosDialog'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { useMediaList, type MediaListSeed } from '@/lib/admin/use-media-list'

// The media library screen, built like the pets list: the view lives in the URL (?search=&page=
// &perPage=) through nuqs, written shallowly (the server is not asked), and the images are fetched
// and cached with SWR (`useMediaList`). The server page only seeds the first render. The search box
// matches the image's name and its description; typing updates the URL after a short pause, Enter
// at once, and a new search goes back to page 1.

const SEARCH_DEBOUNCE_MS = 300

export function MediaLibrary({ initialFilters, initialData }: MediaListSeed) {
  const { filters, data, error, isLoading, mutate } = useMediaList({ initialFilters, initialData })
  const [query, setQuery] = useQueryStates(mediaSearchParsers)

  // A page past the end (the last images on it were deleted, or an old link): step back.
  const lastPage = data && data.totalDocs > 0 && data.page > data.totalPages ? data.totalPages : null
  React.useEffect(() => {
    if (lastPage) void setQuery({ page: lastPage })
  }, [lastPage, setQuery])

  const search = (
    <form
      role="search"
      onSubmit={(event) => {
        // Enter or the button: skip the wait.
        event.preventDefault()
        void setQuery({ search: query.search, page: 1 })
      }}
    >
      <InputGroup className="sm:w-72">
        <InputGroupInput
          type="search"
          name="search"
          aria-label="Search images by name or description"
          placeholder="Search by name or description"
          value={query.search}
          onChange={(event) => void setQuery({ search: event.target.value, page: 1 }, { limitUrlUpdates: debounce(SEARCH_DEBOUNCE_MS) })}
        />
        <InputGroupButton type="submit" aria-label="Search">
          <FiSearch aria-hidden />
        </InputGroupButton>
      </InputGroup>
    </form>
  )

  if (!data) {
    return error ? (
      <div role="alert" className="flex flex-col items-start gap-3 text-sm">
        <p className="text-destructive">The images could not be loaded: {error.message}</p>
        <Button type="button" variant="outline" onClick={() => void mutate()}>
          Try again
        </Button>
      </div>
    ) : (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6" aria-busy="true" aria-label="Loading images">
        {Array.from({ length: Math.min(filters.perPage, 12) }, (_, index) => (
          <Skeleton key={index} className="aspect-square w-full rounded-lg" />
        ))}
      </div>
    )
  }

  const searching = filters.search.trim() !== ''
  return (
    <>
      <MediaGrid
        items={data.docs.map((item) => ({ id: item.id, thumbnailUrl: item.thumbnailUrl, alt: item.alt, name: item.name }))}
        pageKey={`${filters.page}-${filters.perPage}-${filters.search}`}
        // Dim only while a new search or page loads (the previous one stays shown), not on background refetches.
        busy={isLoading && data.docs.length > 0}
        toolbarStart={<UploadPhotosDialog />}
        toolbarEnd={search}
        empty={
          searching ? (
            <EmptyState title="No images match">Nothing is named or described “{filters.search.trim()}”. Try another word.</EmptyState>
          ) : (
            <EmptyState title="No images yet">Upload a photo to get started.</EmptyState>
          )
        }
      />
      {data.totalDocs > 0 ? <MediaPager page={data.page} perPage={filters.perPage} totalDocs={data.totalDocs} totalPages={data.totalPages} /> : null}
    </>
  )
}
