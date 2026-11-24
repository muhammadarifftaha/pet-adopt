'use client'

import { Button } from '@/components/ui/button'

// A screen failed to load (the data layer threw). The message comes from `unwrap`, which only has
// user-safe text.
export default function AdminError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="space-y-3">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  )
}
