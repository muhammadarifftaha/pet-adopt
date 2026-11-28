'use client'

import { useRouter } from 'next/navigation'
import { startTransition } from 'react'

import { Button } from '@pet-adopt/ui/components/button'

/**
 * The error boundary's content for the signed-out screens and the first-time setup, which sit
 * outside the admin's own boundary. Like the admin's: what to do, and the digest as a reference
 * (the message itself only in development, since production replaces it).
 */
export function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter()
  const showMessage = process.env.NODE_ENV === 'development' && error.message
  // reset() alone re-renders with the same failed server data: ask the server again first.
  const retry = () =>
    startTransition(() => {
      router.refresh()
      reset()
    })
  return (
    <div role="alert" className="flex w-full max-w-lg flex-col gap-3 rounded-lg border p-6">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">This page could not be loaded right now. Try again; if it keeps happening, the server log has the details.</p>
      {showMessage ? <p className="text-sm text-muted-foreground">{error.message}</p> : null}
      {error.digest ? (
        <p className="text-sm text-muted-foreground">
          Reference: <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
      <div>
        <Button onClick={retry}>Try again</Button>
      </div>
    </div>
  )
}
