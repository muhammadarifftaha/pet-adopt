'use client'

// A setup step failed to load (often the database). Without this, Next's unstyled default error
// page would show.
import { PageError } from '@/components/auth/PageError'

export default function SetupError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError {...props} />
}
