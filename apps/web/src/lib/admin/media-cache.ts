'use client'

import { useSWRConfig } from 'swr'

/** First entry of every SWR key that holds media library data: ["media", search, page, perPage]. */
export const MEDIA_CACHE_KEY = 'media'

/**
 * Marks every cached library page as out of date and refetches the ones on screen. Call it after
 * anything that changes images from the client (upload, rename, delete): SWR's cache lives in the
 * browser, so the server's `revalidatePath` does not reach it. Same idea as `useInvalidatePets`.
 */
export function useInvalidateMedia() {
  const { mutate } = useSWRConfig()
  return () => mutate((key) => Array.isArray(key) && key[0] === MEDIA_CACHE_KEY)
}
