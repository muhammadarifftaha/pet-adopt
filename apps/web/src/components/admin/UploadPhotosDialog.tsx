'use client'

import React from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { FiAlertCircle, FiCheck, FiUpload, FiX } from 'react-icons/fi'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@pet-adopt/ui/components/alert-dialog'
import { Button } from '@pet-adopt/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@pet-adopt/ui/components/dialog'
import { Input } from '@pet-adopt/ui/components/input'
import { useInvalidateMedia } from '@/lib/admin/media-cache'
import { cleanMediaName, extensionOf, MEDIA_NAME_MAX } from '@/lib/media-name'
import { cn } from '@/lib/utils'
import { uploadMediaAction } from '@/server/actions/media'

// "Upload photos": a dialog with a react-dropzone area (drag and drop, or the "Choose photos"
// button). Every accepted photo is listed with a preview, its own alt text box (the server
// requires one) and a remove button; "Upload" sends them one at a time (one file per request
// keeps each under the server action body limit) and reports each result. Photos that fail stay
// in the list with the reason, so nothing is lost. Closing it (outside click, Escape, the close
// button) while photos are waiting asks first; it cannot close mid-upload. The server stays the authority on type, size and content.

const MAX_BYTES = 10 * 1024 * 1024
const MAX_FILES = 30
const MAX_ALT = 200
const ACCEPT = { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'], 'image/gif': ['.gif'] }

type Status = 'ready' | 'uploading' | 'done' | 'error'
type Queued = { key: string; file: File; preview: string; name: string; alt: string; status: Status; error?: string; altError?: string; nameError?: string }

const keyOf = (file: File) => `${file.name}:${file.size}:${file.lastModified}`
const sizeLabel = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)
const altProblem = (alt: string) => {
  const text = alt.trim()
  if (!text) return 'Describe the photo in a few words.'
  if (text.length > MAX_ALT) return `Use at most ${MAX_ALT} characters.`
  return undefined
}

function rejectionReason({ file, errors }: FileRejection) {
  const code = errors[0]?.code
  if (code === 'file-too-large') return `${file.name} is larger than 10 MB.`
  if (code === 'file-invalid-type') {
    return /\.(heic|heif|avif)$/i.test(file.name)
      ? `${file.name}: HEIC and AVIF photos are not supported. Export it as JPEG first.`
      : `${file.name} is not a JPEG, PNG, WebP or GIF image.`
  }
  if (code === 'too-many-files') return `${file.name} was left out: add at most ${MAX_FILES} photos at a time.`
  return `${file.name} could not be added.`
}

export function UploadPhotosDialog() {
  const invalidateMedia = useInvalidateMedia()
  const [open, setOpen] = React.useState(false)
  const [queue, setQueue] = React.useState<Queued[]>([])
  const [rejected, setRejected] = React.useState<string[]>([])
  const [uploading, setUploading] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const [confirmClose, setConfirmClose] = React.useState(false)

  // Previews are object URLs: free each one when its photo leaves the list, and all on unmount.
  const queueRef = React.useRef(queue)
  React.useEffect(() => {
    queueRef.current = queue
  }, [queue])
  React.useEffect(() => () => queueRef.current.forEach((item) => URL.revokeObjectURL(item.preview)), [])

  const onDrop = (accepted: File[], rejections: FileRejection[]) => {
    const reasons = rejections.map(rejectionReason)
    const known = new Set(queue.map((item) => item.key))
    const fresh = accepted.filter((file) => !known.has(keyOf(file)))
    const room = Math.max(MAX_FILES - queue.length, 0)
    if (fresh.length > room) reasons.push(`Only ${MAX_FILES} photos fit in one upload; ${fresh.length - room} were left out.`)
    const added: Queued[] = fresh.slice(0, room).map((file) => ({ key: keyOf(file), file, preview: URL.createObjectURL(file), name: cleanMediaName(file.name) ?? '', alt: '', status: 'ready' }))
    setRejected(reasons)
    setQueue([...queue, ...added])
    setStatus(added.length ? `${added.length} ${added.length === 1 ? 'photo' : 'photos'} added.` : '')
  }

  const { getRootProps, getInputProps, isDragActive, open: openPicker } = useDropzone({
    onDrop,
    accept: ACCEPT,
    maxSize: MAX_BYTES,
    multiple: true,
    // The "Choose photos" button opens the file picker; the area itself only takes drops, so it
    // is not one more unlabelled stop in the tab order.
    noClick: true,
    noKeyboard: true,
    disabled: uploading,
  })

  const update = (key: string, patch: Partial<Queued>) => setQueue((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))

  const remove = (key: string) => {
    const item = queue.find((entry) => entry.key === key)
    if (item) URL.revokeObjectURL(item.preview)
    setQueue(queue.filter((entry) => entry.key !== key))
    setStatus('Photo removed.')
  }

  const clearAll = () => {
    queue.forEach((item) => URL.revokeObjectURL(item.preview))
    setQueue([])
    setRejected([])
    setStatus('List cleared.')
  }

  const pendingItems = queue.filter((item) => item.status !== 'done')
  const count = pendingItems.length

  const uploadAll = async () => {
    if (uploading || count === 0) return
    // Every photo needs a description before anything is sent.
    const checked = queue.map((item) =>
      item.status === 'done' ? item : { ...item, altError: altProblem(item.alt), nameError: cleanMediaName(item.name) ? undefined : 'Give the photo a name.' },
    )
    const firstMissing = checked.find((item) => item.nameError || item.altError)
    if (firstMissing) {
      setQueue(checked)
      setStatus('Every photo needs a name and a description before uploading.')
      const field = firstMissing.nameError ? 'name' : 'alt'
      requestAnimationFrame(() => document.getElementById(`upload-${field}-${firstMissing.key}`)?.focus())
      return
    }

    setUploading(true)
    let done = 0
    let failed = 0
    for (const [index, item] of pendingItems.entries()) {
      setStatus(`Uploading ${index + 1} of ${count}…`)
      update(item.key, { status: 'uploading', error: undefined })
      const body = new FormData()
      body.set('file', item.file)
      body.set('alt', item.alt.trim())
      body.set('name', item.name.trim())
      try {
        const result = await uploadMediaAction(body)
        if (result.ok) {
          done++
          update(item.key, { status: 'done' })
        } else {
          failed++
          update(item.key, { status: 'error', error: result.fieldErrors?.file ?? (result.fieldErrors?.alt ? undefined : result.error), altError: result.fieldErrors?.alt })
        }
      } catch {
        failed++
        update(item.key, { status: 'error', error: 'The upload did not reach the server. Check the connection and try again.' })
      }
    }
    setUploading(false)
    // The library's pages are cached by SWR in the browser: refetch them.
    if (done) void invalidateMedia()

    if (failed === 0) {
      // Everything is in the library: empty the list and close.
      queueRef.current.forEach((item) => URL.revokeObjectURL(item.preview))
      setQueue([])
      setRejected([])
      setStatus('')
      setOpen(false)
    } else {
      // Keep only what still needs attention.
      setQueue((current) =>
        current.filter((item) => {
          if (item.status === 'done') URL.revokeObjectURL(item.preview)
          return item.status !== 'done'
        }),
      )
      setStatus(`${done} uploaded, ${failed} not uploaded. See the message under each photo.`)
    }
  }

  // Every way of closing (outside click, Escape, the X) comes through here. Waiting photos would be
  // lost, so ask first; the dialog stays open behind the question.
  const requestOpenChange = (next: boolean) => {
    if (uploading) return
    if (!next && count > 0) {
      setConfirmClose(true)
      return
    }
    setOpen(next)
  }

  const discardAndClose = () => {
    queue.forEach((item) => URL.revokeObjectURL(item.preview))
    setQueue([])
    setRejected([])
    setStatus('')
    setConfirmClose(false)
    setOpen(false)
  }

  return (
    <>
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogTrigger render={<Button type="button" />}>
        <FiUpload aria-hidden />
        Upload photos
      </DialogTrigger>
      <DialogContent className="flex h-[min(calc(100dvh-2rem),52rem)] flex-col gap-5 p-6 sm:max-w-4xl" showCloseButton={!uploading}>
        <DialogHeader>
          <DialogTitle>Upload photos</DialogTitle>
          <DialogDescription>JPEG, PNG, WebP or GIF, up to 10 MB each. Location and camera details are removed; the picture itself is not changed.</DialogDescription>
        </DialogHeader>

        <div
          {...getRootProps({
            className: cn(
              'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-12 text-center transition-colors',
              isDragActive ? 'border-ring bg-accent' : 'border-input',
              uploading && 'opacity-50',
            ),
          })}
        >
          <input {...getInputProps()} aria-label="Choose photos to upload" />
          <FiUpload aria-hidden className="size-6 text-muted-foreground" />
          <p className="text-sm">{isDragActive ? 'Drop the photos here' : 'Drag photos here, or'}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => !uploading && openPicker()} aria-disabled={uploading}>
            Choose photos
          </Button>
        </div>

        <p aria-live="polite" className="sr-only">
          {status}
        </p>

        {rejected.length ? (
          <div role="alert" className="flex gap-2 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
            <FiAlertCircle aria-hidden className="mt-0.5 shrink-0" />
            <ul className="flex flex-col gap-1">
              {rejected.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {queue.length ? (
          <ul aria-label="Photos to upload" className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 py-1">
            {queue.map((item, index) => {
              const altId = `upload-alt-${item.key}`
              const errorId = `${altId}-error`
              const fileErrorId = `${altId}-file-error`
              const nameId = `upload-name-${item.key}`
              const nameErrorId = `${nameId}-error`
              const locked = item.status === 'uploading' || item.status === 'done'
              const extension = extensionOf(item.file.name)
              return (
                <li key={item.key} className={cn('flex gap-3 rounded-lg border p-2', item.status === 'error' && 'border-destructive/60')}>
                  {/* Decorative: the description box next to it is where the photo gets described. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.preview} alt="" className="size-24 shrink-0 rounded object-cover" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-xs text-muted-foreground" title={item.file.name}>
                        Photo {index + 1} · {item.file.name} · {sizeLabel(item.file.size)}
                      </p>
                      {item.status === 'uploading' ? <span className="shrink-0 text-xs text-muted-foreground">Uploading…</span> : null}
                      {item.status === 'done' ? (
                        <span className="flex shrink-0 items-center gap-1 text-xs">
                          <FiCheck aria-hidden /> Uploaded
                        </span>
                      ) : null}
                    </div>
                    <div className="grid gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                      <div className="flex min-w-0 flex-col gap-1">
                        <label htmlFor={nameId} className="text-xs font-medium">
                          File name<span className="sr-only">, photo {index + 1}</span>
                        </label>
                        <div className="flex items-center gap-1">
                          <Input
                            id={nameId}
                            value={item.name}
                            maxLength={MEDIA_NAME_MAX}
                            readOnly={locked}
                            spellCheck={false}
                            onChange={(event) => update(item.key, { name: event.target.value, nameError: undefined })}
                            aria-required
                            aria-invalid={Boolean(item.nameError)}
                            aria-describedby={item.nameError ? nameErrorId : undefined}
                          />
                          {/* The type stays as it is: the file is stored unchanged. */}
                          {extension ? <span className="shrink-0 text-sm text-muted-foreground">{extension}</span> : null}
                        </div>
                        {item.nameError ? (
                          <p id={nameErrorId} className="text-xs text-destructive">
                            {item.nameError}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex min-w-0 flex-col gap-1">
                        <label htmlFor={altId} className="text-xs font-medium">
                          Description<span className="font-normal text-muted-foreground"> (required)</span>
                          <span className="sr-only">, photo {index + 1}</span>
                        </label>
                        <Input
                          id={altId}
                          value={item.alt}
                          placeholder="e.g. Ginger kitten asleep on a blanket"
                          readOnly={locked}
                          onChange={(event) => update(item.key, { alt: event.target.value, altError: undefined })}
                          aria-required
                          aria-invalid={Boolean(item.altError)}
                          aria-describedby={[item.altError ? errorId : null, item.error ? fileErrorId : null].filter(Boolean).join(' ') || undefined}
                        />
                        {item.altError ? (
                          <p id={errorId} className="text-xs text-destructive">
                            {item.altError}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    {item.error ? (
                      <p id={fileErrorId} className="text-xs text-destructive">
                        {item.error}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    aria-disabled={uploading}
                    onClick={() => !uploading && remove(item.key)}
                  >
                    <FiX aria-hidden />
                    <span className="sr-only">Remove {item.file.name}</span>
                  </Button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">No photos added yet.</p>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <p className="text-sm text-muted-foreground" aria-hidden="true">
            {uploading ? status : count ? `${count} ${count === 1 ? 'photo' : 'photos'} ready` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {queue.length ? (
              <Button type="button" variant="ghost" aria-disabled={uploading} onClick={() => !uploading && clearAll()}>
                Remove all
              </Button>
            ) : null}
            <Button type="button" aria-disabled={uploading || count === 0} onClick={uploadAll}>
              <FiUpload aria-hidden />
              {uploading ? 'Uploading…' : count > 1 ? `Upload ${count} photos` : 'Upload photo'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Discard {count} {count === 1 ? 'photo' : 'photos'}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {count === 1 ? 'It has' : 'They have'} not been uploaded yet. Closing removes {count === 1 ? 'it' : 'them'} from the list, along with
            any descriptions you typed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* First, so it gets focus: the safe choice. */}
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <Button variant="destructive" onClick={discardAndClose}>
            Discard and close
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
