import { revalidatePath } from 'next/cache'

import { describeError } from '@/server/result'

// revalidatePath throws when called outside a Next.js request (the seed and check scripts), and
// there is nothing to refresh there. Any OTHER failure inside a request means pages will stay stale
// until the 60 second timer, so that one is logged instead of swallowed.
export function safeRevalidate(paths: Array<string | [string, 'layout' | 'page']>) {
  for (const entry of paths) {
    try {
      if (Array.isArray(entry)) revalidatePath(entry[0], entry[1])
      else revalidatePath(entry)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (/static generation store|outside of a request|invariant/i.test(message)) continue
      console.warn(`Could not revalidate ${Array.isArray(entry) ? entry[0] : entry}: ${describeError(error)}`)
    }
  }
}
