'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React from 'react'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@pet-adopt/ui/components/alert-dialog'
import { Badge } from '@pet-adopt/ui/components/badge'
import { Button, buttonVariants } from '@pet-adopt/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pet-adopt/ui/components/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@pet-adopt/ui/components/dialog'
import { Input } from '@pet-adopt/ui/components/input'
import { Label } from '@pet-adopt/ui/components/label'
import { useViewOnly } from '@/components/admin/view-only'
import { EMAIL_PURPOSES, PURPOSE_INFO, type EmailPurpose } from '@/lib/email-template'
import { createEmailTemplateAction, deleteEmailTemplateAction, saveEmailTemplateAction, setDefaultEmailTemplateAction } from '@/server/actions/email-templates'
import type { EmailTemplateSummary } from '@/server/email-templates'

// Settings > Email templates: one section per kind of email the site sends. Each says which
// template is used (the one marked "In use", or the built-in wording) and lists the templates made
// for it. Results go to one status line (an alert for failures).

type Announce = (text: string, isError?: boolean) => void

export function EmailTemplates({ templates }: { templates: EmailTemplateSummary[] }) {
  const router = useRouter()
  const viewOnly = useViewOnly()
  const [message, setMessage] = React.useState<{ text: string; isError: boolean; id: number } | null>(null)
  const announce = React.useCallback<Announce>((text, isError = false) => setMessage((previous) => ({ text, isError, id: (previous?.id ?? 0) + 1 })), [])
  const done = (text: string) => {
    announce(text)
    router.refresh()
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Every email the site sends uses a template. Without one of your own, the built-in wording is used. Templates take the site’s colours and logo.
      </p>
      <div aria-live="polite" className="min-h-5 text-sm">
        {message && !message.isError ? <p key={message.id}>{message.text}</p> : null}
      </div>
      {message?.isError ? (
        <p key={message.id} role="alert" className="text-sm text-destructive">
          {message.text}
        </p>
      ) : null}

      {EMAIL_PURPOSES.map((purpose) => {
        const list = templates.filter((template) => template.purpose === purpose)
        const inUse = list.find((template) => template.isDefault)
        return (
          <Card key={purpose}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <CardTitle>
                    <h2 className="text-base font-semibold">{PURPOSE_INFO[purpose].label}</h2>
                  </CardTitle>
                  <CardDescription>{PURPOSE_INFO[purpose].description}</CardDescription>
                </div>
                {viewOnly ? null : <NewTemplate purpose={purpose} announce={announce} />}
              </div>
              <p className="text-sm">
                In use: <span className="font-medium">{inUse ? inUse.name : 'the built-in template'}</span>
                {purpose.startsWith('form-') ? <span className="text-muted-foreground"> (each form can choose another)</span> : null}
              </p>
            </CardHeader>
            {list.length ? (
              <CardContent>
                <ul className="flex flex-col divide-y">
                  {list.map((template) => (
                    <li key={template.id} className="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0">
                      <span className="mr-auto flex flex-wrap items-center gap-2">
                        <span className="font-medium">{template.name}</span>
                        {template.isDefault ? <Badge>In use</Badge> : null}
                      </span>
                      <Link href={`/edit/email/${template.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                        {viewOnly ? 'View' : 'Edit'}
                        <span className="sr-only"> {template.name}</span>
                      </Link>
                      {viewOnly ? null : (
                        <>
                          <DefaultButton template={template} announce={announce} onDone={done} />
                          <RenameTemplate template={template} onDone={done} />
                          <DuplicateTemplate template={template} announce={announce} />
                          <DeleteTemplate template={template} announce={announce} onDone={done} />
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            ) : null}
          </Card>
        )
      })}
    </div>
  )
}

/** A dialog asking for a name: used to create, copy and rename. */
function NameDialog({
  trigger,
  label,
  title,
  description,
  initial,
  submitLabel,
  onSubmit,
}: {
  trigger: React.ReactElement
  label: React.ReactNode
  title: string
  description: string
  initial: string
  submitLabel: string
  onSubmit: (name: string) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState(initial)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const id = React.useId()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setName(initial)
          setError(null)
        }
      }}
    >
      <DialogTrigger render={trigger}>{label}</DialogTrigger>
      <DialogContent>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (pending) return
            startTransition(async () => {
              const result = await onSubmit(name)
              if (result.ok) setOpen(false)
              else setError(result.error)
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={80}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
            />
            {error ? (
              <p id={`${id}-error`} className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="submit" aria-disabled={pending || undefined}>
              {pending ? 'Working…' : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function NewTemplate({ purpose, announce }: { purpose: EmailPurpose; announce: Announce }) {
  const router = useRouter()
  return (
    <NameDialog
      trigger={<Button type="button" size="sm" />}
      label={
        <>
          New template<span className="sr-only"> for {PURPOSE_INFO[purpose].label}</span>
        </>
      }
      title={`New “${PURPOSE_INFO[purpose].label}” template`}
      description="It starts from the built-in wording; the builder opens next."
      initial=""
      submitLabel="Create and open the builder"
      onSubmit={async (name) => {
        const result = await createEmailTemplateAction({ name, purpose })
        if (!result.ok) return { ok: false, error: result.fieldErrors?.name ?? result.error }
        announce('Template created. Opening the builder…')
        router.push(`/edit/email/${result.data.id}`)
        return { ok: true }
      }}
    />
  )
}

function RenameTemplate({ template, onDone }: { template: EmailTemplateSummary; onDone: (text: string) => void }) {
  return (
    <NameDialog
      trigger={<Button type="button" variant="outline" size="sm" />}
      label={
        <>
          Rename<span className="sr-only"> {template.name}</span>
        </>
      }
      title="Rename the template"
      description="Only people in the admin see this name."
      initial={template.name}
      submitLabel="Rename"
      onSubmit={async (name) => {
        const result = await saveEmailTemplateAction(template.id, { name })
        if (!result.ok) return { ok: false, error: result.fieldErrors?.name ?? result.error }
        onDone(`Renamed to ${result.data.name}.`)
        return { ok: true }
      }}
    />
  )
}

function DuplicateTemplate({ template, announce }: { template: EmailTemplateSummary; announce: Announce }) {
  const router = useRouter()
  return (
    <NameDialog
      trigger={<Button type="button" variant="outline" size="sm" />}
      label={
        <>
          Copy<span className="sr-only"> {template.name}</span>
        </>
      }
      title={`Copy “${template.name}”`}
      description="The copy opens in the builder; the original stays as it is."
      initial={`${template.name} (copy)`.slice(0, 80)}
      submitLabel="Copy and open the builder"
      onSubmit={async (name) => {
        const result = await createEmailTemplateAction({ name, purpose: template.purpose, fromId: template.id })
        if (!result.ok) return { ok: false, error: result.fieldErrors?.name ?? result.error }
        announce('Copied. Opening the builder…')
        router.push(`/edit/email/${result.data.id}`)
        return { ok: true }
      }}
    />
  )
}

function DefaultButton({ template, announce, onDone }: { template: EmailTemplateSummary; announce: Announce; onDone: (text: string) => void }) {
  const [pending, startTransition] = React.useTransition()
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-disabled={pending || undefined}
      onClick={() => {
        if (pending) return
        startTransition(async () => {
          const result = await setDefaultEmailTemplateAction(template.id, !template.isDefault)
          if (result.ok) onDone(template.isDefault ? `${template.name} is no longer used; the built-in template is.` : `${template.name} is now used for these emails.`)
          else announce(result.error, true)
        })
      }}
    >
      {template.isDefault ? 'Stop using' : 'Use this one'}
      <span className="sr-only"> {template.name}</span>
    </Button>
  )
}

function DeleteTemplate({ template, announce, onDone }: { template: EmailTemplateSummary; announce: Announce; onDone: (text: string) => void }) {
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button type="button" variant="destructive" size="sm" />}>
        Delete
        <span className="sr-only"> {template.name}</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{template.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {template.isDefault ? 'It is in use: these emails go back to the built-in template. ' : ''}Forms that picked it use the default instead. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep</AlertDialogCancel>
          <Button
            variant="destructive"
            aria-disabled={pending || undefined}
            onClick={() => {
              if (pending) return
              startTransition(async () => {
                const result = await deleteEmailTemplateAction(template.id)
                setOpen(false)
                if (result.ok) onDone(`${template.name} was deleted.`)
                else announce(result.error, true)
              })
            }}
          >
            {pending ? 'Deleting…' : 'Delete template'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
