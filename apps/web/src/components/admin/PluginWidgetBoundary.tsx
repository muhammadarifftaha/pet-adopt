'use client'

import React from 'react'

/**
 * Keeps one plugin dashboard card's failure inside that card (see PluginWidgets). A widget that
 * throws while rendering on the server reaches the browser as an error in its place in the tree,
 * which this boundary catches; Next has already logged it on the server with the same `digest`.
 * Without it, admin/error.tsx would replace the whole dashboard.
 */
export class PluginWidgetBoundary extends React.Component<
  { children: React.ReactNode },
  { error: unknown; digest: string | null }
> {
  state = { error: null as unknown, digest: null as string | null }

  static getDerivedStateFromError(error: unknown) {
    const digest = typeof error === 'object' && error !== null && 'digest' in error ? String((error as { digest: unknown }).digest) : null
    return { error: error ?? new Error('Unknown error'), digest }
  }

  render() {
    if (this.state.error === null) return this.props.children
    // redirect() and notFound() travel as errors with a NEXT_ digest: leave them to Next.
    if (this.state.digest?.startsWith('NEXT_')) throw this.state.error
    return (
      <p className="text-sm text-muted-foreground">
        This card could not be loaded. Reload the page to try again.
        {this.state.digest ? (
          <>
            {' '}
            Reference: <code className="font-mono">{this.state.digest}</code>
          </>
        ) : null}
      </p>
    )
  }
}
