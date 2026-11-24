'use client'

import { Button } from '@pet-adopt/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@pet-adopt/ui/components/dialog'
import { Field, FieldLabel } from '@pet-adopt/ui/components/field'
import { Input } from '@pet-adopt/ui/components/input'
import { useRouter } from 'next/navigation'
import React, { useState, useTransition } from 'react'

import { createFormAction } from '../actions'
import { editHref } from './paths'

// "New form": asks only for a name, then opens the editor for the fields.
export function NewFormButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    startTransition(async () => {
      const result = await createFormAction({ name })
      if (result.ok) {
        setOpen(false)
        router.push(editHref(result.data.id))
      } else setError(result.fieldErrors?.name ?? result.error)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setName('')
          setError(null)
        }
      }}
    >
      <DialogTrigger render={<Button />}>New form</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New form</DialogTitle>
            <DialogDescription>Name it for yourself, such as “Adoption application”. You add the questions next.</DialogDescription>
          </DialogHeader>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="new-form-name">Name (required)</FieldLabel>
            <Input
              id="new-form-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'new-form-name-error' : undefined}
              autoFocus
            />
            {error && (
              <p id="new-form-name-error" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </Field>
          <DialogFooter>
            <Button type="submit" aria-disabled={pending || undefined}>
              {pending ? 'Creating…' : 'Create and add questions'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
