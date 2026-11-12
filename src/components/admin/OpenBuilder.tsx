'use client'

import { useDocumentInfo } from '@payloadcms/ui'
import React from 'react'

// Shown on the page edit screen: jumps to the Puck page builder for this page.
export const OpenBuilder: React.FC = () => {
  const { id } = useDocumentInfo()

  return (
    <div style={{ marginBottom: 'var(--base)' }}>
      <div className="field-label" style={{ marginBottom: 8 }}>
        Page layout
      </div>
      {id ? (
        <a className="btn btn--style-primary btn--size-medium" href={`/edit/${id}`}>
          <span className="btn__content">Open page builder</span>
        </a>
      ) : (
        <p style={{ opacity: 0.7, margin: 0 }}>Save the page first, then open the page builder.</p>
      )}
    </div>
  )
}
