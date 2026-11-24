'use client'

import { useSearchParams } from 'next/navigation'
import type { inferParserType } from 'nuqs/server'
import useSWR from 'swr'

import { loadMediaSearchParams, mediaSearchParsers } from '@/app/(admin)/admin/media/search-params'
import { listMediaAction } from '@/server/actions/media'
import type { listMedia } from '@/server/media'

import { MEDIA_CACHE_KEY } from './media-cache'
import { unwrapResult } from './unwrap-client'

export type MediaListFilters = inferParserType<typeof mediaSearchParsers>
export type MediaListPage = Awaited<ReturnType<typeof listMedia>>

/** What the server page loaded for the URL it was opened with: the first render's view and data. */
export type MediaListSeed = { initialFilters: MediaListFilters; initialData: MediaListPage }

// One entry per part of the view, so every search, page and size is cached on its own.
const keyOf = (f: MediaListFilters) => [MEDIA_CACHE_KEY, f.search, f.page, f.perPage] as const

/**
 * The media library for the URL as it is now (the search box writes it, debounced), fetched and
 * cached with SWR, like `usePetList`. The server's data only seeds the key it was rendered for.
 * `keepPreviousData` keeps the last page on screen while the next one loads, so paging and typing
 * do not flash an empty grid.
 */
export function useMediaList({ initialFilters, initialData }: MediaListSeed) {
  const filters = loadMediaSearchParams(useSearchParams())
  const key = keyOf(filters)
  const isInitial = JSON.stringify(key) === JSON.stringify(keyOf(initialFilters))

  const result = useSWR(
    key,
    async ([, search, page, perPage]) => unwrapResult(await listMediaAction({ search: search || undefined, page, limit: perPage })),
    { fallbackData: isInitial ? initialData : undefined, keepPreviousData: true },
  )

  return { filters, ...result }
}
