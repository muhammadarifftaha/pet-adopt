'use client'

import { useRouter } from 'next/navigation'
import React from 'react'
import { FiTrash2 } from 'react-icons/fi'

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
import { Field, FieldDescription, FieldError, FieldLabel } from '@pet-adopt/ui/components/field'
import { Input } from '@pet-adopt/ui/components/input'
import { Textarea } from '@pet-adopt/ui/components/textarea'
import { useInvalidateMedia } from '@/lib/admin/media-cache'
import { cleanMediaName, MEDIA_NAME_MAX } from '@/lib/media-name'
import { deleteMediaAction, updateMediaDetailsAction } from '@/server/actions/media'

// The image page's controls: rename (the display name; the stored file keeps its random name) and
// edit the alt text, saved together (same rules as the server: both required, alt at most 200
// characters), and delete. Delete is refused while the image is used, so the button says why
// instead of opening the dialog; the server still checks.

const MAX_ALT = 200

export function MediaDetails({
  id,
  name: savedName,
  alt,
  extension,
  inUse,
}: {
  id: number
  /** The display name, or null for older images (the box then starts empty). */
  name: string | null
  alt: string
  /** ".jpg": shown after the name box, as the type does not change. */
  extension: string
  inUse: boolean
}) {
  const router = useRouter()
  const invalidateMedia = useInvalidateMedia()
  const [name, setName] = React.useState(savedName ?? '')
  const [text, setText] = React.useState(alt)
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState('')
  const [saving, startSaving] = React.useTransition()
  const [deleting, startDeleting] = React.useTransition()
  const [confirming, setConfirming] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const changed = (cleanMediaName(name) ?? '') !== (savedName ?? '') || text.trim() !== alt.trim()

  const save = (event: React.FormEvent) => {
    event.preventDefault()
    if (saving || !changed) return
    const cleaned = cleanMediaName(name)
    const value = text.trim()
    const nameProblem = cleaned ? null : 'Give the image a name.'
    const altProblem = !value ? 'Describe the image in a few words (the alt text).' : value.length > MAX_ALT ? `Keep the alt text under ${MAX_ALT} characters.` : null
    setNameError(nameProblem)
    setError(altProblem)
    if (nameProblem || altProblem) {
      document.getElementById(nameProblem ? 'media-name' : 'media-alt')?.focus()
      return
    }
    startSaving(async () => {
      const result = await updateMediaDetailsAction(id, { name: cleaned!, alt: value })
      if (result.ok) {
        // Show the name as it was stored (cleaned).
        setName(result.data.name ?? '')
        setStatus('Saved.')
        router.refresh()
        void invalidateMedia()
      } else {
        setNameError(result.fieldErrors?.name ?? null)
        setError(result.fieldErrors?.alt ?? (result.fieldErrors?.name ? null : result.error))
      }
    })
  }

  const remove = () => {
    setConfirming(false)
    startDeleting(async () => {
      const result = await deleteMediaAction(id)
      if (result.ok) {
        void invalidateMedia()
        router.push('/admin/media')
        router.refresh()
      } else {
        setDeleteError(result.error)
      }
    })
  }

  return (
    <>
      <form onSubmit={save} noValidate className="flex flex-col gap-3" aria-labelledby="media-alt-heading">
        <h2 id="media-alt-heading" className="font-semibold">
          Details
        </h2>
        <Field data-invalid={nameError ? true : undefined}>
          <FieldLabel htmlFor="media-name">
            File name<span className="font-normal text-muted-foreground"> (required)</span>
          </FieldLabel>
          <FieldDescription id="media-name-description">
            How the image is listed in the library and found in search. Links to it do not change.
          </FieldDescription>
          <div className="flex items-center gap-1.5">
            <Input
              id="media-name"
              value={name}
              maxLength={MEDIA_NAME_MAX}
              spellCheck={false}
              onChange={(event) => {
                setName(event.target.value)
                setNameError(null)
                setStatus('')
              }}
              aria-invalid={Boolean(nameError)}
              aria-required
              aria-describedby={`media-name-description${nameError ? ' media-name-error' : ''}`}
            />
            {extension ? <span className="shrink-0 text-sm text-muted-foreground">{extension}</span> : null}
          </div>
          <FieldError id="media-name-error" errors={nameError ? [{ message: nameError }] : []} />
        </Field>
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor="media-alt">
            Alt text<span className="font-normal text-muted-foreground"> (required)</span>
          </FieldLabel>
          <FieldDescription id="media-alt-description">
            Read aloud by screen readers and shown when the image cannot load. Say what it shows, for example “Ginger kitten asleep on a
            blanket”.
          </FieldDescription>
          <Textarea
            id="media-alt"
            rows={3}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setStatus('')
            }}
            aria-invalid={Boolean(error)}
            aria-required
            aria-describedby={`media-alt-description${error ? ' media-alt-error' : ''}`}
          />
          <FieldError id="media-alt-error" errors={error ? [{ message: error }] : []} />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" aria-disabled={saving || !changed}>
            {saving ? 'Saving…' : 'Save details'}
          </Button>
          <p role="status" aria-live="polite" className="text-sm">
            {status}
          </p>
        </div>
      </form>

      <section aria-labelledby="media-delete-heading" className="flex flex-col gap-2 border-t pt-4">
        <h2 id="media-delete-heading" className="font-semibold">
          Delete
        </h2>
        {inUse ? (
          <p id="media-delete-blocked" className="text-sm text-muted-foreground">
            This image is in use. Replace it in the places listed above before deleting it.
          </p>
        ) : null}
        <div>
          <Button
            type="button"
            variant="destructive"
            aria-disabled={inUse || deleting}
            aria-describedby={inUse ? 'media-delete-blocked' : undefined}
            onClick={() => !inUse && !deleting && setConfirming(true)}
          >
            <FiTrash2 aria-hidden />
            {deleting ? 'Deleting…' : 'Delete image'}
          </Button>
        </div>
        {deleteError ? (
          <p role="alert" className="text-sm text-destructive">
            {deleteError}
          </p>
        ) : null}
      </section>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this image?</AlertDialogTitle>
            <AlertDialogDescription>It is removed from the library for good, with its file.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button variant="destructive" onClick={remove}>
              Delete image
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
