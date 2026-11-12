import '@puckeditor/core/puck.css'
import React from 'react'

import '../(frontend)/styles.css'
import './editor.css'

export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
