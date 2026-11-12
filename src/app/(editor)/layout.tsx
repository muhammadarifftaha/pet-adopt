import '@puckeditor/core/puck.css'
import React from 'react'

import { ThemeStyle } from '@/components/site/ThemeStyle'
import { getSettings } from '@/lib/queries'

import '../(frontend)/fonts'
import '../(frontend)/styles.css'
import './editor.css'

export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings()
  return (
    <html lang="en">
      <head>
        {/* The page builder shows blocks in the site's theme, light only, so the editor chrome stays readable. */}
        <ThemeStyle settings={settings} lightOnly />
      </head>
      <body>{children}</body>
    </html>
  )
}
