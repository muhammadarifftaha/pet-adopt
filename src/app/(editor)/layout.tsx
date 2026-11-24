import '@puckeditor/core/puck.css'
import React from 'react'

import { PRE_PAINT, ThemeStyle } from '@/components/site/ThemeStyle'
import { getSettings } from '@/lib/queries'
import { resolveTheme } from '@/lib/theme'

import '../(frontend)/fonts'
import '../(frontend)/styles.css'
import './editor.css'

export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings()
  // The editor's own interface follows the owner's light/dark choice, like the admin: their saved
  // choice (the pre-paint script sets data-mode), else their system setting. Only when the site has
  // dark mode at all; otherwise the admin is light only, and so is this. See editor.css.
  const followMode = resolveTheme(settings).allowModeToggle
  return (
    // suppressHydrationWarning: the pre-paint script may set data-mode before React hydrates.
    <html lang="en" data-follow-mode={followMode ? '' : undefined} suppressHydrationWarning>
      <head>
        {/* The blocks use the site's theme, light only; the canvas has its own "Dark preview" switch. */}
        <ThemeStyle settings={settings} lightOnly />
        {/* A constant string: nothing from the settings goes into it. */}
        {followMode ? <script dangerouslySetInnerHTML={{ __html: PRE_PAINT }} /> : null}
      </head>
      <body>{children}</body>
    </html>
  )
}
