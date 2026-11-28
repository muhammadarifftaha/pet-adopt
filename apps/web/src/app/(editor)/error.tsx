'use client'

import React from 'react'

// A builder (page or email) failed: a server error while opening it, or an error in the editor
// itself. Inside the editor layout, so Puck's colours and editor.css apply (no Tailwind here). The
// error's own text is not shown: it may be technical, and in production Next replaces it anyway.
export default function EditorError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="editor-error">
      <div role="alert">
        <h1>The builder stopped because of an error</h1>
        <p>
          What was saved before this is kept: drafts you saved, and the page builder’s autosave. Changes made since the last save may
          be lost.
        </p>
        <p>If your session ended, sign in again in another tab, then reload this one.</p>
      </div>
      <div className="editor-error-actions">
        <button type="button" className="editor-primary" onClick={() => window.location.reload()}>
          Reload the builder
        </button>
        <button type="button" onClick={reset}>
          Try again
        </button>
        {/* A full page load: the admin is another root layout, and a fresh start is the point here. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/admin">Back to the admin</a>
      </div>
    </main>
  )
}
