'use client'

import React from 'react'

/** The message the theme editor sends to its preview iframe. */
export type ThemePreviewMessage = { type: 'pet-adopt-theme-preview'; css: string; mode: 'light' | 'dark' }

// Inside the theme editor's preview iframe: applies the theme CSS the editor sends (built there by
// resolveTheme + themeCss from validated values), so the preview changes as the owner edits, with no
// reload. Only messages from this site are accepted, and the CSS is set as text, never as markup.
// On load it tells the editor it is ready, so the current draft is sent straight away.
export function ThemePreviewBridge() {
  const styleRef = React.useRef<HTMLStyleElement>(null)

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as Partial<ThemePreviewMessage> | null
      if (!data || data.type !== 'pet-adopt-theme-preview' || typeof data.css !== 'string') return
      if (styleRef.current) styleRef.current.textContent = data.css
      document.documentElement.setAttribute('data-mode', data.mode === 'dark' ? 'dark' : 'light')
    }
    window.addEventListener('message', onMessage)
    window.parent?.postMessage({ type: 'pet-adopt-theme-preview-ready' }, window.location.origin)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return <style ref={styleRef} />
}
