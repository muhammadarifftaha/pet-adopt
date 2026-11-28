'use client'

import { useRouter } from 'next/navigation'
import { startTransition } from 'react'

import { Button } from '@pet-adopt/ui/components/button'

// A screen failed to load (the data layer threw, often through `unwrap`). In a production build
// Next.js replaces the message of an error thrown on the server with a generic sentence and gives a
// `digest` instead, which is also printed beside the error in the server log. So the screen says
// what to do and shows the digest as a reference; the message itself only in development.
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter()
  const showMessage = process.env.NODE_ENV === 'development' && error.message
  // reset() alone re-renders with the same failed server data: ask the server again first.
  const retry = () =>
    startTransition(() => {
      router.refresh()
      reset()
    })
  return (
    <div role="alert" className="space-y-3">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        This screen could not be loaded. Try again; if it keeps happening, the server log has the details.
      </p>
      {showMessage ? <p className="text-sm text-muted-foreground">{error.message}</p> : null}
      {error.digest ? (
        <p className="text-sm text-muted-foreground">
          Reference: <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
      <Button onClick={retry}>Try again</Button>
    </div>
  )
}
