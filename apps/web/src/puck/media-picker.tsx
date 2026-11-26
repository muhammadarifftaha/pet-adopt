'use client'

import React, { useCallback, useState } from 'react'

import { listMediaAction, uploadMediaAction } from '@/server/actions/media'

import type { MediaValue } from './types'

type MediaDoc = {
  id: number | string
  url: string
  alt: string
  thumbnailUrl?: string
}

const toValue = (doc: MediaDoc): NonNullable<MediaValue> => ({ id: doc.id, url: doc.url, alt: doc.alt || '' })

// Lets owners pick an existing upload or add a new one without leaving the page builder.
export function MediaPicker({
  value,
  onChange,
  label,
  readOnly = false,
}: {
  value: MediaValue
  onChange: (value: MediaValue) => void
  label?: string
  /** Puck passes it to custom fields when editing is off (view-only roles): the image shows, nothing changes. */
  readOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<MediaDoc[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [alt, setAlt] = useState('')
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listMediaAction({ limit: 60 })
      if (!result.ok) throw new Error(result.error)
      setItems(result.data.docs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the media library.')
    } finally {
      setLoading(false)
    }
  }, [])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) void load()
  }

  async function upload(file: File) {
    if (!alt.trim()) {
      setError('Add a short description of the image first (used for accessibility).')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('alt', alt.trim())
      const result = await uploadMediaAction(form)
      if (!result.ok) throw new Error(result.fieldErrors?.file || result.fieldErrors?.alt || result.error)
      onChange(toValue(result.data))
      setAlt('')
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="media-picker">
      {label && <div className="media-picker-label">{label}</div>}
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="media-picker-preview" src={value.url} alt={value.alt} />
      ) : (
        <div className="media-picker-empty">No image selected</div>
      )}
      <fieldset disabled={readOnly} className="media-picker-fieldset">
      <div className="media-picker-actions">
        <button type="button" onClick={toggle}>
          {open ? 'Close' : value ? 'Change image' : 'Choose image'}
        </button>
        {value && (
          <button type="button" onClick={() => onChange(null)}>
            Remove
          </button>
        )}
      </div>
      {open && (
        <div className="media-picker-panel">
          <div className="media-picker-upload">
            <input type="text" placeholder="Describe the image (alt text)" value={alt} onChange={(e) => setAlt(e.target.value)} />
            <input
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void upload(file)
                e.target.value = ''
              }}
            />
            {uploading && <span>Uploading…</span>}
          </div>
          {error && <p className="media-picker-error">{error}</p>}
          {loading ? (
            <p>Loading…</p>
          ) : (
            <div className="media-picker-grid">
              {items.map((doc) => (
                <button
                  type="button"
                  key={doc.id}
                  title={doc.alt}
                  onClick={() => {
                    onChange(toValue(doc))
                    setOpen(false)
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={doc.thumbnailUrl || doc.url} alt={doc.alt} />
                </button>
              ))}
              {!items.length && <p>No uploads yet. Add one above.</p>}
            </div>
          )}
        </div>
      )}
      </fieldset>
    </div>
  )
}
