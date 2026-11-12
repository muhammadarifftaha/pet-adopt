import { revalidatePath } from 'next/cache'

// revalidatePath throws when called outside a Next.js request (e.g. the seed script),
// so every call is wrapped.
export function safeRevalidate(paths: Array<string | [string, 'layout' | 'page']>) {
  for (const entry of paths) {
    try {
      if (Array.isArray(entry)) revalidatePath(entry[0], entry[1])
      else revalidatePath(entry)
    } catch {
      // not in a Next.js context, nothing to revalidate
    }
  }
}
