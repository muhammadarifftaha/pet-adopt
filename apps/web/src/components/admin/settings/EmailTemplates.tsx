'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React from 'react'
import { FiPlus } from 'react-icons/fi'

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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@pet-adopt/ui/components/dialog'
import { Input } from '@pet-adopt/ui/components/input'
import { Label } from '@pet-adopt/ui/components/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pet-adopt/ui/components/table'
import { useViewOnly } from '@/components/admin/view-only'
import { LIBRARY_PURPOSES, PURPOSE_INFO, type EmailPurpose, type SystemPurpose } from '@/lib/email-template'
import {
  createEmailTemplateAction,
  deleteEmailTemplateAction,
  restoreSeededTemplateAction,
  restoreSystemEmailAction,
  saveEmailTemplateAction,
} from '@/server/actions/email-templates'
import type { EmailTemplateSummary } from '@/server/email-templates'

// Email > Templates, as one table:
//  - System emails first (password reset, test email): one each, edited in place, with "Restore
//    default" (back to the built-in version).
//  - Then every other template, as many as people like. A template is used only where something
//    picks it ("Used by": a form, or any other plugin). Plugins ship default templates ("Default"):
//    editable and restorable, never deleted, used when nothing else is picked. "Created by" is blank
//    for system emails and plugin defaults.
// From sm up it is a table; on phones one card per row. Results go to one status line (an alert for failures).

export type SystemEmailStatus = { purpose: SystemPurpose; customised: boolean; updatedAt: Date | string | null }
export type TemplateRow = EmailTemplateSummary & { usedBy: Array<{ label: string; href?: string }> }

type Announce = (text: string, isError?: boolean) => void

/** Short names for the kinds of templates people make. */
const TYPE_LABELS: Record<EmailPurpose, string> = {
  'password-reset': 'System email',
  invite: 'System email',
  'email-change': 'System email',
  'email-changed': 'System email',
  test: 'System email',
  'team-notification': 'Team notification',
  'visitor-message': 'Message to a visitor',
}
const TYPE_HINTS: Record<EmailPurpose, string> = {
  'password-reset': '',
  invite: '',
  'email-change': '',
  'email-changed': '',
  test: '',
  'team-notification': 'To your team; can list the details',
  'visitor-message': 'To someone outside the team; never repeats what they typed',
}

const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })
const when = (value: Date | string | null) => (value ? date.format(new Date(value)) : null)

export function EmailTemplates({ templates, system }: { templates: TemplateRow[]; system: SystemEmailStatus[] }) {
  const router = useRouter()
  const viewOnly = useViewOnly()
  const [message, setMessage] = React.useState<{ text: string; isError: boolean; id: number } | null>(null)
  const announce = React.useCallback<Announce>((text, isError = false) => setMessage((previous) => ({ text, isError, id: (previous?.id ?? 0) + 1 })), [])
  const done = (text: string) => {
    announce(text)
    router.refresh()
  }

  const systemActions = (email: SystemEmailStatus) => (
    <>
      <Link href={`/edit/email/${email.purpose}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        {viewOnly ? 'View' : 'Edit'}
        <span className="sr-only"> the {PURPOSE_INFO[email.purpose].label} email</span>
      </Link>
      {email.customised && !viewOnly ? <RestoreSystemEmail purpose={email.purpose} announce={announce} onDone={done} /> : null}
    </>
  )
  const templateActions = (template: TemplateRow) => (
    <>
      <Link href={`/edit/email/${template.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        {viewOnly ? 'View' : 'Edit'}
        <span className="sr-only"> {template.name}</span>
      </Link>
      {viewOnly ? null : (
        <>
          <RenameTemplate template={template} onDone={done} />
          <CopyTemplate template={template} announce={announce} />
          {template.seedKey ? (
            template.edited ? <RestoreSeededTemplate template={template} announce={announce} onDone={done} /> : null
          ) : (
            <DeleteTemplate template={template} announce={announce} onDone={done} />
          )}
        </>
      )}
    </>
  )
  const usedBy = (template: TemplateRow) =>
    template.usedBy.length ? (
      <ul className="flex flex-col gap-0.5">
        {template.usedBy.map((use) => (
          <li key={use.label}>
            {use.href ? (
              <Link href={use.href} className="underline underline-offset-4">
                {use.label}
              </Link>
            ) : (
              use.label
            )}
          </li>
        ))}
      </ul>
    ) : (
      <span className="text-muted-foreground">Not used</span>
    )
  const templateName = (template: TemplateRow) => (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-medium">{template.name}</span>
      {template.seedKey ? <Badge variant="outline">Default</Badge> : null}
    </span>
  )
  const systemStatus = (email: SystemEmailStatus) =>
    email.customised ? <span>{when(email.updatedAt)}</span> : <span className="text-muted-foreground">Never</span>

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto max-w-2xl text-sm text-muted-foreground">
          System emails are edited directly; Restore default brings back the built-in version. Make as many templates as you like and choose them where emails are sent, such as on a form. Templates marked Default come with a plugin and are used when nothing else is chosen.
        </p>
        {viewOnly ? null : <NewTemplate announce={announce} />}
      </div>

      <div aria-live="polite" className="min-h-5 text-sm">
        {message && !message.isError ? <p key={message.id}>{message.text}</p> : null}
      </div>
      {message?.isError ? (
        <p key={message.id} role="alert" className="text-sm text-destructive">
          {message.text}
        </p>
      ) : null}

      {/* Phones: one card per row. From sm up: the table. Only one is displayed. */}
      <ul className="flex flex-col gap-3 sm:hidden" aria-label="Email templates">
        {system.map((email) => (
          <li key={email.purpose} className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{PURPOSE_INFO[email.purpose].label}</span>
              <Badge variant="secondary">System email</Badge>
            </span>
            <span className="text-muted-foreground">{PURPOSE_INFO[email.purpose].description}</span>
            {systemStatus(email)}
            <span className="flex flex-wrap gap-2 pt-1">{systemActions(email)}</span>
          </li>
        ))}
        {templates.map((template) => (
          <li key={template.id} className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
            {templateName(template)}
            <span>
              {TYPE_LABELS[template.purpose]} <span className="text-muted-foreground">· {TYPE_HINTS[template.purpose]}</span>
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-muted-foreground">Used by</span>
              {usedBy(template)}
            </span>
            <span className="text-muted-foreground">
              Edited {when(template.updatedAt)}
              {template.createdByName ? ` · Created by ${template.createdByName}` : ''}
            </span>
            <span className="flex flex-wrap gap-2 pt-1">{templateActions(template)}</span>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-lg border sm:block">
        <Table>
          <caption className="sr-only">System emails, then the templates people made, in name order.</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Used by</TableHead>
              <TableHead>Created by</TableHead>
              <TableHead>Last edited</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {system.map((email) => (
              <TableRow key={email.purpose} className="align-top">
                <TableCell className="font-medium">{PURPOSE_INFO[email.purpose].label}</TableCell>
                <TableCell>
                  <Badge variant="secondary">System email</Badge>
                </TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">{PURPOSE_INFO[email.purpose].description}</TableCell>
                <TableCell>
                  <span className="sr-only">None</span>
                </TableCell>
                <TableCell className="whitespace-nowrap">{systemStatus(email)}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center justify-end gap-2">{systemActions(email)}</span>
                </TableCell>
              </TableRow>
            ))}
            {templates.map((template) => (
              <TableRow key={template.id} className="align-top">
                <TableCell className="whitespace-normal">{templateName(template)}</TableCell>
                <TableCell className="whitespace-normal">
                  <span className="flex flex-col">
                    <span>{TYPE_LABELS[template.purpose]}</span>
                    <span className="text-xs text-muted-foreground">{TYPE_HINTS[template.purpose]}</span>
                  </span>
                </TableCell>
                <TableCell className="whitespace-normal">{usedBy(template)}</TableCell>
                <TableCell className="whitespace-normal">{template.createdByName ?? <span className="sr-only">None</span>}</TableCell>
                <TableCell className="whitespace-nowrap">{when(template.updatedAt)}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center justify-end gap-2">{templateActions(template)}</span>
                </TableCell>
              </TableRow>
            ))}
            {templates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="whitespace-normal text-center text-muted-foreground">
                  No templates yet. Make one, then choose it where emails are sent, for example on a form.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function RestoreSystemEmail({ purpose, announce, onDone }: { purpose: SystemPurpose; announce: Announce; onDone: (text: string) => void }) {
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const label = PURPOSE_INFO[purpose].label
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        Restore default<span className="sr-only"> {label} email</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restore the default “{label}” email?</AlertDialogTitle>
          <AlertDialogDescription>Your changes to this email are removed and the built-in version is sent again. This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep my changes</AlertDialogCancel>
          <Button
            aria-disabled={pending || undefined}
            onClick={() => {
              if (pending) return
              startTransition(async () => {
                const result = await restoreSystemEmailAction(purpose)
                setOpen(false)
                if (result.ok) onDone(`The “${label}” email is back to its default.`)
                else announce(result.error, true)
              })
            }}
          >
            {pending ? 'Restoring…' : 'Restore default'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function RestoreSeededTemplate({ template, announce, onDone }: { template: TemplateRow; announce: Announce; onDone: (text: string) => void }) {
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        Restore default<span className="sr-only"> {template.name}</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restore the default “{template.name}”?</AlertDialogTitle>
          <AlertDialogDescription>Your changes to its layout are removed and the plugin’s original comes back. Its name stays. This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep my changes</AlertDialogCancel>
          <Button
            aria-disabled={pending || undefined}
            onClick={() => {
              if (pending) return
              startTransition(async () => {
                const result = await restoreSeededTemplateAction(template.id)
                setOpen(false)
                if (result.ok) onDone(`${template.name} is back to its default.`)
                else announce(result.error, true)
              })
            }}
          >
            {pending ? 'Restoring…' : 'Restore default'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

type NameErrors = { name?: string; purpose?: string; general?: string }

/** A dialog asking for a name (and, for a new template, its type): used to create, copy and rename. */
function NameDialog({
  trigger,
  label,
  title,
  description,
  initial,
  submitLabel,
  withType = false,
  onSubmit,
}: {
  trigger: React.ReactElement
  label: React.ReactNode
  title: string
  description: string
  initial: string
  submitLabel: string
  withType?: boolean
  onSubmit: (name: string, purpose: EmailPurpose) => Promise<{ ok: true } | { ok: false; errors: NameErrors }>
}) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState(initial)
  const [purpose, setPurpose] = React.useState<EmailPurpose>('team-notification')
  const [errors, setErrors] = React.useState<NameErrors>({})
  const [pending, startTransition] = React.useTransition()
  const id = React.useId()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setName(initial)
          setErrors({})
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
              const result = await onSubmit(name, purpose)
              if (result.ok) setOpen(false)
              else setErrors(result.errors)
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
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `${id}-name-error` : undefined}
            />
            {errors.name ? (
              <p id={`${id}-name-error`} className="text-sm text-destructive">
                {errors.name}
              </p>
            ) : null}
          </div>
          {withType ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Type</legend>
              {LIBRARY_PURPOSES.map((value) => (
                <label key={value} className="flex items-start gap-2 text-sm">
                  <input type="radio" name={`${id}-type`} value={value} checked={purpose === value} onChange={() => setPurpose(value)} className="mt-1" />
                  <span>
                    <span className="font-medium">{TYPE_LABELS[value]}</span>
                    <span className="block text-muted-foreground">{PURPOSE_INFO[value].description}</span>
                  </span>
                </label>
              ))}
              {errors.purpose ? <p className="text-sm text-destructive">{errors.purpose}</p> : null}
            </fieldset>
          ) : null}
          {errors.general ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.general}
            </p>
          ) : null}
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

const failure = (result: { error: string; fieldErrors?: Record<string, string> }) => ({
  ok: false as const,
  errors: result.fieldErrors ? { name: result.fieldErrors.name, purpose: result.fieldErrors.purpose } : { general: result.error },
})

function NewTemplate({ announce }: { announce: Announce }) {
  const router = useRouter()
  return (
    <NameDialog
      trigger={<Button type="button" />}
      label={
        <>
          <FiPlus aria-hidden />
          New template
        </>
      }
      title="New email template"
      description="It starts from the built-in email of that type; the builder opens next. Choose it where emails are sent, such as on a form."
      initial=""
      submitLabel="Create and open the builder"
      withType
      onSubmit={async (name, purpose) => {
        const result = await createEmailTemplateAction({ name, purpose })
        if (!result.ok) return failure(result)
        announce('Template created. Opening the builder…')
        router.push(`/edit/email/${result.data.id}`)
        return { ok: true }
      }}
    />
  )
}

function RenameTemplate({ template, onDone }: { template: TemplateRow; onDone: (text: string) => void }) {
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
        if (!result.ok) return failure(result)
        onDone(`Renamed to ${result.data.name}.`)
        return { ok: true }
      }}
    />
  )
}

function CopyTemplate({ template, announce }: { template: TemplateRow; announce: Announce }) {
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
        if (!result.ok) return failure(result)
        announce('Copied. Opening the builder…')
        router.push(`/edit/email/${result.data.id}`)
        return { ok: true }
      }}
    />
  )
}

function DeleteTemplate({ template, announce, onDone }: { template: TemplateRow; announce: Announce; onDone: (text: string) => void }) {
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const uses = template.usedBy.length
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
            {uses ? `It is used ${uses === 1 ? 'once' : `${uses} times`} (${template.usedBy.map((use) => use.label).join(', ')}); those send the built-in email instead. ` : ''}
            This cannot be undone.
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
