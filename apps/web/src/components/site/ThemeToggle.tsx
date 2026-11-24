'use client'

import React, { useSyncExternalStore } from 'react'

import { MODE_STORAGE_KEY } from '@/lib/theme'

type Mode = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

// The page's mode lives on <html data-mode>, set by the pre-paint script or by this button, and
// otherwise follows the device. Reading it as an external store keeps React in step with both.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] })
  const media = window.matchMedia(DARK_QUERY)
  media.addEventListener('change', onChange)
  return () => {
    observer.disconnect()
    media.removeEventListener('change', onChange)
  }
}

function currentMode(): Mode | null {
  const chosen = document.documentElement.getAttribute('data-mode')
  if (chosen === 'dark' || chosen === 'light') return chosen
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

// The server cannot know the visitor's mode, so the button starts disabled until the client reads it.
const serverMode = (): Mode | null => null

/** Light/dark switch for visitors. Their choice is kept in this browser only. */
export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribe, currentMode, serverMode)

  function toggle() {
    const next: Mode = mode === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-mode', next)
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next)
    } catch {
      // Storage can be blocked (private windows). The choice still applies until the page closes.
    }
  }

  const dark = mode === 'dark'
  return (
    <button
      type="button"
      className="mode-toggle"
      onClick={toggle}
      disabled={mode === null}
      aria-pressed={dark}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  )
}
