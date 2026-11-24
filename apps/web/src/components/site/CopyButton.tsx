'use client'

import React from 'react'

// Copies a piece of text (bank details, a DuitNow number) and says so in a polite live region.
// The text itself stays visible and selectable, so the button is only a shortcut.
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = React.useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
    window.setTimeout(() => setState('idle'), 2500)
  }
  return (
    <span className="copy-button">
      <button type="button" className="btn btn-outline btn-small" onClick={copy}>
        {label}
      </button>
      <span aria-live="polite" className="copy-status">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy. Select the text instead.' : ''}
      </span>
    </span>
  )
}
