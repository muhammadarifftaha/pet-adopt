'use client'

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
import { Button } from '@pet-adopt/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pet-adopt/ui/components/card'
import { Checkbox } from '@pet-adopt/ui/components/checkbox'
import { Input } from '@pet-adopt/ui/components/input'
import { Label } from '@pet-adopt/ui/components/label'
import { Switch } from '@pet-adopt/ui/components/switch'
import { Textarea } from '@pet-adopt/ui/components/textarea'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React, { useRef, useState, useTransition } from 'react'

import { deleteFormAction, updateFormAction } from '../actions'
import {
  FORM_FIELD_TYPES,
  FORM_LIMITS,
  FORM_SOURCES,
  OPTION_TYPES,
  newFieldId,
  validateFormFields,
  validateFormSettings,
  type FormField,
  type FormFieldType,
  type FormSettings,
} from '../fields'
import { BASE, responsesHref } from './paths'

// The form editor: details, the fields (add, change, reorder with buttons, remove) and settings.
// Accessibility, as in the app's own forms: every control has a visible label; hints and errors are
// tied with aria-describedby; a failed save shows one error summary that takes focus and links to
// each field; moves are announced in a polite live region; Save uses aria-disabled, not disabled.

/** The site's email templates the form can pick from (Settings > Templates). */
export type TemplateChoices = { notification: Array<{ id: number; name: string; isDefault: boolean }>; confirmation: Array<{ id: number; name: string; isDefault: boolean }> }

export type EditorForm = {
  id: number
  name: string
  description: string | null
  fields: FormField[]
  settings: FormSettings
  isOpen: boolean
  responses: number
}

/** A field while it is edited: options as one per line. */
type Draft = FormField & { optionsText: string }

const toDraft = (field: FormField): Draft => ({ ...field, optionsText: (field.options ?? []).join('\n') })
const typeLabel = (type: FormFieldType) => FORM_FIELD_TYPES.find((t) => t.value === type)?.label ?? type

const nativeSelect =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive dark:bg-input/30'

function toPayload(drafts: Draft[]): FormField[] {
  return drafts.map(({ optionsText, ...field }) => {
    const out: FormField = { id: field.id, type: field.type, label: field.label, required: field.required }
    if (field.hint?.trim()) out.hint = field.hint
    if (OPTION_TYPES.includes(field.type)) {
      out.options = optionsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      if (field.type === 'choice' && field.display === 'dropdown') out.display = 'dropdown'
    }
    if (field.type === 'source') out.source = field.source ?? 'pets'
    return out
  })
}

export function FormEditor({
  form,
  readOnly = false,
  canSeeResponses = true,
  templates = { notification: [], confirmation: [] },
}: {
  form: EditorForm
  readOnly?: boolean
  canSeeResponses?: boolean
  templates?: TemplateChoices
}) {
  const router = useRouter()
  const [name, setName] = useState(form.name)
  const [description, setDescription] = useState(form.description ?? '')
  const [isOpen, setIsOpen] = useState(form.isOpen)
  const [drafts, setDrafts] = useState<Draft[]>(form.fields.map(toDraft))
  const [settings, setSettings] = useState<FormSettings>(form.settings)
  const [newType, setNewType] = useState<FormFieldType>('text')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [summary, setSummary] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [announce, setAnnounce] = useState('')
  const [pending, startTransition] = useTransition()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const summaryRef = useRef<HTMLDivElement>(null)

  const fieldIndex = (key: string) => Number(key.split('.')[1])
  // Where each error key lives on the page, for the summary's links.
  function targetOf(key: string): { id: string; label: string } {
    if (key === 'name') return { id: 'fb-name', label: 'Name' }
    if (key === 'description') return { id: 'fb-description', label: 'Description' }
    if (key.startsWith('settings.')) {
      const k = key.slice('settings.'.length)
      const labels: Record<string, string> = {
        notifyEmail: 'Email new responses to',
        submitLabel: 'Button text',
        successMessage: 'Message after sending',
        notifyTemplateId: 'Notification template',
        confirmationFieldId: 'Send the confirmation to',
        confirmationTemplateId: 'Confirmation template',
      }
      return { id: `fb-settings-${k}`, label: labels[k] ?? k }
    }
    if (key.startsWith('fields.')) {
      const draft = drafts[fieldIndex(key)]
      const part = key.split('.')[2]
      const label = draft ? `Question ${fieldIndex(key) + 1}${draft.label ? ` (${draft.label})` : ''}` : 'Questions'
      if (!draft) return { id: 'fb-fields', label }
      return { id: `fb-${draft.id}-${part === 'options' ? 'options' : part === 'source' ? 'source' : part === 'type' ? 'type' : part === 'hint' ? 'hint' : 'label'}`, label }
    }
    return { id: 'fb-fields', label: 'Questions' }
  }
  // Option errors (fields.N.options.M) are shown once, under the options box.
  const errorFor = (index: number, part: 'label' | 'hint' | 'options') => {
    const prefix = `fields.${index}.${part}`
    return errors[prefix] ?? Object.entries(errors).find(([key]) => key.startsWith(`${prefix}.`))?.[1]
  }

  function update(index: number, patch: Partial<Draft>) {
    setDrafts((current) => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)))
  }

  function move(index: number, by: -1 | 1) {
    const to = index + by
    if (to < 0 || to >= drafts.length) return
    const next = [...drafts]
    const [moved] = next.splice(index, 1)
    next.splice(to, 0, moved)
    setDrafts(next)
    setErrors({})
    setAnnounce(`“${moved.label || typeLabel(moved.type)}” moved to position ${to + 1} of ${next.length}.`)
    // Keep focus on the same button of the moved field; at an edge, on the other direction's button.
    requestAnimationFrame(() => {
      const edge = (by === -1 && to === 0) || (by === 1 && to === next.length - 1)
      document.getElementById(`fb-${moved.id}-${edge ? (by === -1 ? 'down' : 'up') : by === -1 ? 'up' : 'down'}`)?.focus()
    })
  }

  function remove(index: number) {
    const removed = drafts[index]
    const next = drafts.filter((_, i) => i !== index)
    setDrafts(next)
    setErrors({})
    setAnnounce(`“${removed.label || typeLabel(removed.type)}” removed. Save to keep the change.`)
    requestAnimationFrame(() => document.getElementById(next.length ? `fb-${next[Math.min(index, next.length - 1)].id}-label` : 'fb-add-type')?.focus())
  }

  function add() {
    if (drafts.length >= FORM_LIMITS.fields) return
    const draft: Draft = {
      id: newFieldId(),
      type: newType,
      label: '',
      required: false,
      optionsText: OPTION_TYPES.includes(newType) ? 'Option 1\nOption 2' : '',
      ...(newType === 'source' ? { source: 'pets' as const } : {}),
    }
    setDrafts((current) => [...current, draft])
    setAnnounce(`${typeLabel(newType)} question added as number ${drafts.length + 1}.`)
    requestAnimationFrame(() => document.getElementById(`fb-${draft.id}-label`)?.focus())
  }

  function fail(found: Record<string, string>, message: string) {
    setErrors(found)
    setSummary(message)
    setStatus('')
    requestAnimationFrame(() => summaryRef.current?.focus())
  }

  // Email questions, as they are being edited (a confirmation is sent to the answer of one).
  const emailQuestions = drafts.filter((draft) => draft.type === 'email')

  function templateSelect(key: 'notifyTemplateId' | 'confirmationTemplateId', choices: TemplateChoices['notification']) {
    const fallback = choices.find((choice) => choice.isDefault)
    return (
      <select
        id={`fb-settings-${key}`}
        className={nativeSelect}
        value={settings[key] ? String(settings[key]) : ''}
        onChange={(e) => setSettings({ ...settings, [key]: e.target.value ? Number(e.target.value) : undefined })}
        aria-describedby={described(`fb-settings-${key}-hint`, errors[`settings.${key}`] && `fb-settings-${key}-error`)}
        aria-invalid={errors[`settings.${key}`] ? true : undefined}
      >
        <option value="">{fallback ? `The default (${fallback.name})` : 'The default (built in)'}</option>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name}
          </option>
        ))}
        {/* A template that was deleted since: still shown, so the choice is visible; the email uses the default. */}
        {settings[key] && !choices.some((choice) => choice.id === settings[key]) ? <option value={String(settings[key])}>A deleted template (the default is used)</option> : null}
      </select>
    )
  }

  function save() {
    if (pending) return
    const fields = toPayload(drafts)
    // The same checks the server runs, for instant feedback. The server checks again.
    const found: Record<string, string> = {}
    if (!name.trim()) found.name = 'Give the form a name.'
    const checkedFields = validateFormFields(fields)
    if (!checkedFields.ok) Object.assign(found, checkedFields.errors)
    const checkedSettings = validateFormSettings(settings)
    if (!checkedSettings.ok) Object.assign(found, checkedSettings.errors)
    if (Object.keys(found).length) return fail(found, 'Please fix the highlighted fields.')

    startTransition(async () => {
      const result = await updateFormAction(form.id, { name, description, isOpen, fields, settings })
      if (!result.ok) return fail(result.fieldErrors ?? {}, result.error)
      setErrors({})
      setSummary(null)
      setDrafts(result.data.fields.map(toDraft))
      setSettings(result.data.settings)
      setStatus('Saved. Pages that show this form use the new version.')
      router.refresh()
    })
  }

  function confirmDelete() {
    startTransition(async () => {
      const result = await deleteFormAction(form.id)
      if (result.ok) router.push(BASE)
      else {
        setDeleteOpen(false)
        fail({}, result.error)
      }
    })
  }

  const described = (...ids: Array<string | false | undefined>) => ids.filter(Boolean).join(' ') || undefined
  const errorText = (id: string, message?: string) =>
    message ? (
      <p id={id} className="text-sm text-destructive">
        {message}
      </p>
    ) : null

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link href={BASE} className="underline underline-offset-4">
          All forms
        </Link>
        {/* Responses are personal data: no link for roles that cannot open them (developers). */}
        {canSeeResponses ? (
          <>
            <span aria-hidden="true">·</span>
            <Link href={responsesHref(form.id)} className="underline underline-offset-4">
              {form.responses} {form.responses === 1 ? 'response' : 'responses'}
            </Link>
          </>
        ) : null}
      </div>

      {summary && (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-lg border border-destructive p-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring">
          <p className="font-medium">{summary}</p>
          {Object.keys(errors).length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {Object.entries(errors).map(([key, message]) => {
                const target = targetOf(key)
                return (
                  <li key={key}>
                    <a href={`#${target.id}`} className="underline underline-offset-4">
                      {target.label}: {message}
                    </a>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* View-only roles (audit): every control below is off; the server refuses changes too. */}
      <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
      {readOnly ? (
        <p className="rounded-md border bg-muted px-3 py-2 text-sm">
          <span className="font-medium">View only.</span> Your role can view this form but not change it.
        </p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>The name is shown as the form&apos;s heading unless the page gives it another one.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="fb-name">Name (required)</Label>
            <Input id="fb-name" value={name} maxLength={FORM_LIMITS.name} onChange={(e) => setName(e.target.value)} aria-invalid={errors.name ? true : undefined} aria-describedby={described(errors.name && 'fb-name-error')} />
            {errorText('fb-name-error', errors.name)}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="fb-description">Description</Label>
            <Textarea id="fb-description" value={description} maxLength={FORM_LIMITS.description} onChange={(e) => setDescription(e.target.value)} aria-describedby={described('fb-description-hint', errors.description && 'fb-description-error')} aria-invalid={errors.description ? true : undefined} />
            <p id="fb-description-hint" className="text-sm text-muted-foreground">
              Shown above the questions. Leave a blank line between paragraphs.
            </p>
            {errorText('fb-description-error', errors.description)}
          </div>
          <div className="flex items-center gap-3">
            <Switch id="fb-open" checked={isOpen} onCheckedChange={(checked) => setIsOpen(checked)} aria-describedby="fb-open-hint" />
            <Label htmlFor="fb-open">Accepting responses</Label>
          </div>
          <p id="fb-open-hint" className="-mt-2 text-sm text-muted-foreground">
            When off, the form stays on the page with a note that it is closed.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle id="fb-fields" tabIndex={-1}>
            Questions
          </CardTitle>
          <CardDescription>Visitors answer them in this order. Changing a question never changes the answers already received.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {drafts.length === 0 && <p className="text-sm text-muted-foreground">No questions yet. Add the first one below.</p>}
          <ol className="flex flex-col gap-4">
            {drafts.map((draft, index) => {
              const title = draft.label || typeLabel(draft.type)
              const labelError = errorFor(index, 'label')
              const hintError = errorFor(index, 'hint')
              const optionsError = errorFor(index, 'options')
              return (
                <li key={draft.id} className="rounded-lg border p-4">
                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-1 text-sm font-medium">
                      Question {index + 1}: {typeLabel(draft.type)}
                    </legend>
                    <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`fb-${draft.id}-label`}>Question (required)</Label>
                        <Input id={`fb-${draft.id}-label`} value={draft.label} maxLength={FORM_LIMITS.label} onChange={(e) => update(index, { label: e.target.value })} aria-invalid={labelError ? true : undefined} aria-describedby={described(labelError && `fb-${draft.id}-label-error`)} />
                        {errorText(`fb-${draft.id}-label-error`, labelError)}
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`fb-${draft.id}-type`}>Answer type</Label>
                        <select
                          id={`fb-${draft.id}-type`}
                          className={nativeSelect}
                          value={draft.type}
                          onChange={(e) => {
                            const type = e.target.value as FormFieldType
                            update(index, {
                              type,
                              optionsText: OPTION_TYPES.includes(type) && !draft.optionsText ? 'Option 1\nOption 2' : draft.optionsText,
                              source: type === 'source' ? (draft.source ?? 'pets') : draft.source,
                            })
                          }}
                        >
                          {FORM_FIELD_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label htmlFor={`fb-${draft.id}-hint`}>Hint</Label>
                      <Input id={`fb-${draft.id}-hint`} value={draft.hint ?? ''} maxLength={FORM_LIMITS.hint} onChange={(e) => update(index, { hint: e.target.value })} aria-invalid={hintError ? true : undefined} aria-describedby={described(hintError && `fb-${draft.id}-hint-error`)} />
                      {errorText(`fb-${draft.id}-hint-error`, hintError)}
                    </div>

                    {OPTION_TYPES.includes(draft.type) && (
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`fb-${draft.id}-options`}>Options (required)</Label>
                        <Textarea id={`fb-${draft.id}-options`} rows={4} value={draft.optionsText} onChange={(e) => update(index, { optionsText: e.target.value })} aria-invalid={optionsError ? true : undefined} aria-describedby={described(`fb-${draft.id}-options-hint`, optionsError && `fb-${draft.id}-options-error`)} />
                        <p id={`fb-${draft.id}-options-hint`} className="text-sm text-muted-foreground">
                          One per line, up to {FORM_LIMITS.options}.
                        </p>
                        {errorText(`fb-${draft.id}-options-error`, optionsError)}
                      </div>
                    )}

                    {draft.type === 'source' && (
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`fb-${draft.id}-source`}>List</Label>
                        <select
                          id={`fb-${draft.id}-source`}
                          className={nativeSelect}
                          value={draft.source ?? 'pets'}
                          onChange={(e) => update(index, { source: FORM_SOURCES.find((s) => s.value === e.target.value)?.value ?? 'pets' })}
                          aria-describedby={`fb-${draft.id}-source-hint`}
                        >
                          {FORM_SOURCES.map((source) => (
                            <option key={source.value} value={source.value}>
                              {source.label}
                            </option>
                          ))}
                        </select>
                        <p id={`fb-${draft.id}-source-hint`} className="text-sm text-muted-foreground">
                          Filled in when the form is shown: pets that are listed and not adopted, by name. New pets appear on their own.
                        </p>
                      </div>
                    )}

                    {draft.type === 'choice' && (
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`fb-${draft.id}-display`}>Shown as</Label>
                        <select id={`fb-${draft.id}-display`} className={nativeSelect} value={draft.display ?? 'radio'} onChange={(e) => update(index, { display: e.target.value === 'dropdown' ? 'dropdown' : 'radio' })}>
                          <option value="radio">Buttons, all options visible</option>
                          <option value="dropdown">A dropdown list</option>
                        </select>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Checkbox id={`fb-${draft.id}-required`} checked={draft.required} onCheckedChange={(checked) => update(index, { required: checked === true })} />
                      <Label htmlFor={`fb-${draft.id}-required`}>{draft.type === 'checkbox' ? 'Must be ticked' : 'Answer required'}</Label>
                    </div>

                    <div className="flex flex-wrap gap-2 border-t pt-3">
                      <Button id={`fb-${draft.id}-up`} type="button" variant="outline" size="sm" aria-disabled={index === 0 || undefined} onClick={() => index > 0 && move(index, -1)} aria-label={`Move “${title}” up`}>
                        Move up
                      </Button>
                      <Button id={`fb-${draft.id}-down`} type="button" variant="outline" size="sm" aria-disabled={index === drafts.length - 1 || undefined} onClick={() => index < drafts.length - 1 && move(index, 1)} aria-label={`Move “${title}” down`}>
                        Move down
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)} aria-label={`Remove “${title}”`}>
                        Remove
                      </Button>
                    </div>
                  </fieldset>
                </li>
              )
            })}
          </ol>

          <div className="flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="fb-add-type">New question&apos;s answer type</Label>
              <select id="fb-add-type" className={nativeSelect} value={newType} onChange={(e) => setNewType(e.target.value as FormFieldType)}>
                {FORM_FIELD_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" variant="outline" onClick={add} aria-disabled={drafts.length >= FORM_LIMITS.fields || undefined}>
              Add question
            </Button>
          </div>
          <p aria-live="polite" className="sr-only">
            {announce}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>After sending</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="fb-settings-submitLabel">Button text</Label>
            <Input id="fb-settings-submitLabel" placeholder="Send" maxLength={FORM_LIMITS.submitLabel} value={settings.submitLabel ?? ''} onChange={(e) => setSettings({ ...settings, submitLabel: e.target.value })} aria-invalid={errors['settings.submitLabel'] ? true : undefined} aria-describedby={described(errors['settings.submitLabel'] && 'fb-settings-submitLabel-error')} />
            {errorText('fb-settings-submitLabel-error', errors['settings.submitLabel'])}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="fb-settings-successMessage">Message after sending</Label>
            <Textarea id="fb-settings-successMessage" maxLength={FORM_LIMITS.successMessage} value={settings.successMessage ?? ''} onChange={(e) => setSettings({ ...settings, successMessage: e.target.value })} aria-describedby={described('fb-settings-successMessage-hint', errors['settings.successMessage'] && 'fb-settings-successMessage-error')} aria-invalid={errors['settings.successMessage'] ? true : undefined} />
            <p id="fb-settings-successMessage-hint" className="text-sm text-muted-foreground">
              Blank shows “Thank you. We have received your answers and will be in touch.”
            </p>
            {errorText('fb-settings-successMessage-error', errors['settings.successMessage'])}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="fb-settings-notifyEmail">Email new responses to</Label>
            <Input id="fb-settings-notifyEmail" type="email" autoComplete="email" value={settings.notifyEmail ?? ''} onChange={(e) => setSettings({ ...settings, notifyEmail: e.target.value })} aria-describedby={described('fb-settings-notifyEmail-hint', errors['settings.notifyEmail'] && 'fb-settings-notifyEmail-error')} aria-invalid={errors['settings.notifyEmail'] ? true : undefined} />
            <p id="fb-settings-notifyEmail-hint" className="text-sm text-muted-foreground">
              Optional. Needs the site&apos;s email to be set up (Settings, Email).
            </p>
            {errorText('fb-settings-notifyEmail-error', errors['settings.notifyEmail'])}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="fb-settings-notifyTemplateId">Notification template</Label>
            {templateSelect('notifyTemplateId', templates.notification)}
            <p id="fb-settings-notifyTemplateId-hint" className="text-sm text-muted-foreground">
              How the email to the address above looks. Templates are made in Settings, Templates.
            </p>
            {errorText('fb-settings-notifyTemplateId-error', errors['settings.notifyTemplateId'])}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Confirmation to the visitor</CardTitle>
          <CardDescription>
            Optional: email the person who filled in the form, to the address they gave. It never repeats their answers, and each address gets at most 3 an hour.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="fb-settings-confirmationFieldId">Send the confirmation to</Label>
            <select
              id="fb-settings-confirmationFieldId"
              className={nativeSelect}
              value={settings.confirmationFieldId ?? ''}
              onChange={(e) => setSettings({ ...settings, confirmationFieldId: e.target.value || undefined })}
              aria-describedby={described('fb-settings-confirmationFieldId-hint', errors['settings.confirmationFieldId'] && 'fb-settings-confirmationFieldId-error')}
              aria-invalid={errors['settings.confirmationFieldId'] ? true : undefined}
            >
              <option value="">No confirmation</option>
              {emailQuestions.map((question) => (
                <option key={question.id} value={question.id}>
                  The answer to “{question.label || 'Untitled question'}”
                </option>
              ))}
            </select>
            <p id="fb-settings-confirmationFieldId-hint" className="text-sm text-muted-foreground">
              {emailQuestions.length ? 'Pick the Email question that holds their address.' : 'Add an Email question to the form first.'}
            </p>
            {errorText('fb-settings-confirmationFieldId-error', errors['settings.confirmationFieldId'])}
          </div>
          {settings.confirmationFieldId ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="fb-settings-confirmationTemplateId">Confirmation template</Label>
              {templateSelect('confirmationTemplateId', templates.confirmation)}
              <p id="fb-settings-confirmationTemplateId-hint" className="text-sm text-muted-foreground">
                What the visitor receives. Templates are made in Settings, Templates.
              </p>
              {errorText('fb-settings-confirmationTemplateId-error', errors['settings.confirmationTemplateId'])}
            </div>
          ) : null}
        </CardContent>
      </Card>
      </fieldset>

      {readOnly ? null : (
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={save} aria-disabled={pending || undefined}>
          {pending ? 'Saving…' : 'Save form'}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogTrigger render={<Button type="button" variant="destructive" className="ml-auto" />}>Delete form</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{form.name}” and its responses?</AlertDialogTitle>
              <AlertDialogDescription>
                {form.responses > 0 ? `Its ${form.responses} ${form.responses === 1 ? 'response is' : 'responses are'} deleted too. ` : ''}
                Pages that show it hide the form block. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <Button variant="destructive" aria-disabled={pending || undefined} onClick={() => !pending && confirmDelete()}>
                {pending ? 'Deleting…' : 'Delete form'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      )}
    </div>
  )
}
