'use client'

// A sign-in, reset, invite or confirm-email page failed to load (often the database). Without this,
// Next's unstyled default error page would show.
import { PageError } from '@/components/auth/PageError'

export default function AuthError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError {...props} />
}
