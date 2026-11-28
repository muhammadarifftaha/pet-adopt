'use client'

import { FieldLabel } from '@puckeditor/core'
import React, { useEffect, useId, useRef, useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'

import { listMediaAction, uploadMediaAction } from '@/server/actions/media'
import type { MediaItem } from '@/server/types'

import type { MediaValue } from './types'

/** Images per page of the library. */
const PAGE_SIZE = 12
/** First entry of the library's SWR keys (the same as the admin's picker), so an upload refreshes every cached page. */
const MEDIA_KEY = 'media'
/** What the server accepts (no SVG, AVIF or HEIC). */
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'

const toValue = (doc: MediaItem): NonNullable<MediaValue> => ({ id: doc.id, url: doc.url, alt: doc.alt || '' })

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

type UploadErrors = { file?: string; alt?: string; general?: string }

// Lets owners pick an existing upload or add a new one without leaving the page builder (and the
// email builder). The editor has no Tailwind, so it is plain HTML styled in editor.css. Puck draws
// no label for a custom field, so the field's name comes from Puck's FieldLabel here.
export function MediaPicker({
  value,
  onChange,
  label = 'Image',
  readOnly = false,
}: {
  value: MediaValue
  onChange: (value: MediaValue) => void
  label?: string
  /** Puck passes it to custom fields when editing is off (view-only roles): the image shows, nothing changes. */
  readOnly?: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  // The panel closes when an image is picked or uploaded, taking the focused control with it:
  // focus goes back to the button that opened it.
  const refocus = useRef(false)
  useEffect(() => {
    if (!open && refocus.current) {
      refocus.current = false
      toggleRef.current?.focus()
    }
  }, [open])

  const choose = (doc: MediaItem) => {
    onChange(toValue(doc))
    refocus.current = true
    setOpen(false)
  }

  const panelId = `${id}-panel`
  return (
    <div className="media-picker" role="group" aria-label={label}>
      <FieldLabel label={label} el="div" readOnly={readOnly}>
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="media-picker-preview" src={value.url} alt={value.alt} />
        ) : (
          <div className="media-picker-empty">No image selected</div>
        )}
      </FieldLabel>
      <fieldset disabled={readOnly} className="media-picker-fieldset">
        <div className="media-picker-actions">
          <button ref={toggleRef} type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
            {open ? 'Close' : value ? 'Change image' : 'Choose image'}
          </button>
          {value && (
            <button type="button" onClick={() => onChange(null)}>
              Remove
            </button>
          )}
        </div>
        {/* Mounted only while open, so it starts fresh each time. */}
        {open && <PickerPanel id={panelId} onChoose={choose} />}
      </fieldset>
    </div>
  )
}

function PickerPanel({ id, onChoose }: { id: string; onChoose: (doc: MediaItem) => void }) {
  const { mutate } = useSWRConfig()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const query = useDebounced(search.trim(), 300)
  // keepPreviousData: the grid and the pager stay while the next page loads, so the Previous or Next
  // button that was pressed keeps the focus.
  const { data, error, isLoading } = useSWR(
    [MEDIA_KEY, query, page] as const,
    async ([, term, pageNumber]) => {
      const result = await listMediaAction({ search: term, page: pageNumber, limit: PAGE_SIZE })
      if (!result.ok) throw new Error(result.error)
      return result.data
    },
    { keepPreviousData: true },
  )

  const [alt, setAlt] = useState('')
  const [uploading, setUploading] = useState(false)
  const [errors, setErrors] = useState<UploadErrors>({})
  const fileRef = useRef<HTMLInputElement>(null)
  const altRef = useRef<HTMLInputElement>(null)

  async function upload() {
    if (uploading) return
    const file = fileRef.current?.files?.[0]
    const next: UploadErrors = {}
    if (!file) next.file = 'Choose an image file to upload.'
    if (!alt.trim()) next.alt = 'Describe the image first: it is read aloud to people who cannot see it.'
    if (next.file || next.alt) {
      setErrors(next)
      // The first field in the form that needs fixing.
      if (next.alt) altRef.current?.focus()
      else fileRef.current?.focus()
      return
    }
    setUploading(true)
    setErrors({})
    const form = new FormData()
    form.append('file', file as File)
    form.append('alt', alt.trim())
    const result = await uploadMediaAction(form).catch(() => ({ ok: false as const, error: 'Could not reach the server. Check your connection.', fieldErrors: undefined }))
    setUploading(false)
    if (!result.ok) {
      setErrors({ file: result.fieldErrors?.file, alt: result.fieldErrors?.alt, general: result.fieldErrors?.file || result.fieldErrors?.alt ? undefined : result.error })
      return
    }
    void mutate((key) => Array.isArray(key) && key[0] === MEDIA_KEY)
    onChoose(result.data)
  }

  const altId = `${id}-alt`
  const fileId = `${id}-file`
  const searchId = `${id}-search`
  const lastPage = data?.totalPages ?? 1
  return (
    <div id={id} className="media-picker-panel">
      <div className="media-picker-upload" role="group" aria-labelledby={`${id}-upload-title`}>
        <p id={`${id}-upload-title`} className="media-picker-subtitle">
          Upload a new image
        </p>
        {errors.general ? (
          <p role="alert" className="media-picker-error">
            {errors.general}
          </p>
        ) : null}
        <label htmlFor={altId}>Description of the image (required)</label>
        <input
          ref={altRef}
          id={altId}
          type="text"
          value={alt}
          autoComplete="off"
          aria-required="true"
          aria-invalid={errors.alt ? true : undefined}
          aria-describedby={`${altId}-hint${errors.alt ? ` ${altId}-error` : ''}`}
          onChange={(event) => {
            setAlt(event.target.value)
            if (errors.alt) setErrors((current) => ({ ...current, alt: undefined }))
          }}
        />
        <span id={`${altId}-hint`} className="media-picker-hint">
          Read aloud to people who cannot see it, for example “Orange kitten asleep on a blue blanket”.
        </span>
        {errors.alt ? (
          <span id={`${altId}-error`} role="alert" className="media-picker-error">
            {errors.alt}
          </span>
        ) : null}
        <label htmlFor={fileId}>Image file (required)</label>
        <input
          ref={fileRef}
          id={fileId}
          name="file"
          type="file"
          accept={ACCEPT}
          aria-required="true"
          aria-invalid={errors.file ? true : undefined}
          aria-describedby={`${fileId}-hint${errors.file ? ` ${fileId}-error` : ''}`}
          onChange={() => {
            if (errors.file) setErrors((current) => ({ ...current, file: undefined }))
          }}
        />
        <span id={`${fileId}-hint`} className="media-picker-hint">
          JPEG, PNG, WebP or GIF, up to 10 MB.
        </span>
        {errors.file ? (
          <span id={`${fileId}-error`} role="alert" className="media-picker-error">
            {errors.file}
          </span>
        ) : null}
        <div>
          <button type="button" aria-disabled={uploading} onClick={() => void upload()}>
            {uploading ? 'Uploading…' : 'Upload and use'}
          </button>
        </div>
      </div>

      <div className="media-picker-library" role="group" aria-labelledby={`${id}-library-title`}>
        <p id={`${id}-library-title`} className="media-picker-subtitle">
          Or choose from the library
        </p>
        <label htmlFor={searchId}>Search images by name or description</label>
        <input
          id={searchId}
          type="search"
          autoComplete="off"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
        {error ? (
          <p role="alert" className="media-picker-error">
            Could not load the images: {error instanceof Error ? error.message : 'unknown error'}
          </p>
        ) : null}
        {isLoading && !data ? (
          <p role="status">Loading images…</p>
        ) : data && !data.docs.length ? (
          <p>{query ? 'No images match that search.' : 'No uploads yet. Add one above.'}</p>
        ) : data ? (
          <ul className="media-picker-grid" aria-busy={isLoading || undefined}>
            {data.docs.map((doc) => (
              <li key={doc.id}>
                <button type="button" aria-label={`Use ${doc.alt || doc.name || `image ${doc.id}`}`} title={doc.alt || doc.name || undefined} onClick={() => onChoose(doc)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={doc.thumbnailUrl || doc.url} alt="" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {data && lastPage > 1 ? (
          <div className="media-picker-pages">
            {/* aria-disabled, not disabled: reaching the first or last page must not drop focus. */}
            <button type="button" aria-disabled={page <= 1} onClick={() => page > 1 && setPage(page - 1)}>
              Previous
            </button>
            <span aria-live="polite">
              Page {data.page} of {lastPage}
            </span>
            <button type="button" aria-disabled={page >= lastPage} onClick={() => page < lastPage && setPage(page + 1)}>
              Next
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
