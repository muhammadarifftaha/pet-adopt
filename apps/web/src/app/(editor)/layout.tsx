import '@puckeditor/core/puck.css'
import type { Metadata } from 'next'
import React from 'react'

import { PRE_PAINT, ThemeStyle } from '@/components/site/ThemeStyle'
import { getSettings, siteIcons } from '@/lib/queries'
import { puckDarkCss, resolveTheme } from '@/lib/theme'

import '../(frontend)/fonts'
import '../(frontend)/styles.css'
import './editor.css'

export async function generateMetadata(): Promise<Metadata> {
  return { icons: siteIcons(await getSettings()) }
}

export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings()
  // The editor's own interface follows the owner's light/dark choice, like the admin: their saved
  // choice (the pre-paint script sets data-mode), else their system setting. Only when the site has
  // dark mode at all; otherwise the admin is light only, and so is this. See editor.css.
  const theme = resolveTheme(settings)
  const followMode = theme.allowModeToggle
  return (
    // suppressHydrationWarning: the pre-paint script may set data-mode before React hydrates.
    <html lang="en" data-follow-mode={followMode ? '' : undefined} suppressHydrationWarning>
      <head>
        {/* The blocks use the site's theme, light only; the canvas has its own "Dark preview" switch. */}
        <ThemeStyle settings={settings} lightOnly />
        {/* A constant string: nothing from the settings goes into it. */}
        {followMode ? <script dangerouslySetInnerHTML={{ __html: PRE_PAINT }} /> : null}
        {/* Puck's colours in dark mode, from the site theme's dark colours (validated values only). */}
        {followMode ? <style dangerouslySetInnerHTML={{ __html: puckDarkCss(theme) }} /> : null}
      </head>
      <body>{children}</body>
    </html>
  )
}
