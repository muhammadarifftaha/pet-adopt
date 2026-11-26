'use client'

import { useCallback, useSyncExternalStore } from 'react'

import { MODE_STORAGE_KEY } from '@/lib/theme'

// Light or dark, for the public site's switch (ThemeToggle) and the admin's user menu. The mode lives
// on <html data-mode>, set by the pre-paint script (ThemeStyle) from the choice saved in this
// browser, or by a switch; without one it follows the device. Reading it as an external store keeps
// React in step with all of those. Both use the same saved choice, so the admin and the site match.

export type ColorMode = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

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

function currentMode(): ColorMode {
  const chosen = document.documentElement.getAttribute('data-mode')
  if (chosen === 'dark' || chosen === 'light') return chosen
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

// The server cannot know the mode: null until the browser has read it.
const serverMode = (): ColorMode | null => null

/** The current mode (null while rendering on the server) and a setter that saves the choice. */
export function useColorMode(): [ColorMode | null, (mode: ColorMode) => void] {
  const mode = useSyncExternalStore<ColorMode | null>(subscribe, currentMode, serverMode)
  const setMode = useCallback((next: ColorMode) => {
    document.documentElement.setAttribute('data-mode', next)
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next)
    } catch {
      // Storage can be blocked (private windows). The choice still applies until the page closes.
    }
  }, [])
  return [mode, setMode]
}
