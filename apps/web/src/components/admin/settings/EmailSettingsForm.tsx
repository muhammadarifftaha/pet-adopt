'use client'

import { useRouter } from 'next/navigation'
import React from 'react'
import { FiAlertTriangle, FiCheckCircle } from 'react-icons/fi'

import { Badge } from '@pet-adopt/ui/components/badge'
import { Button } from '@pet-adopt/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pet-adopt/ui/components/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@pet-adopt/ui/components/field'
import { Input } from '@pet-adopt/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pet-adopt/ui/components/select'
import { useViewOnly, ViewOnlyFieldset } from '@/components/admin/view-only'
import { saveEmailSettingsAction } from '@/server/actions/email'
import type { EmailField, EmailSettingsView } from '@/server/email'

// Email > Sending: the built-in SMTP sender. Fields an environment variable sets are read-only and
// say which variable. The password is write-only: the form only knows whether one is saved, and an
// empty box keeps it. Errors: one summary (focused) plus plain text under each field, since several
// can show at once.

type Values = { host: string; port: string; security: string; username: string; password: string; fromName: string; fromAddress: string; replyTo: string }

const SECURITY_ITEMS = [
  { value: 'starttls', label: 'STARTTLS (usually port 587)' },
  { value: 'tls', label: 'SSL/TLS (usually port 465)' },
  { value: 'none', label: 'None, not encrypted (local test servers only)' },
]
const DEFAULT_PORT: Record<string, string> = { starttls: '587', tls: '465', none: '25' }

const LABELS: Record<keyof Values, string> = {
  host: 'SMTP server',
  port: 'Port',
  security: 'Encryption',
  username: 'User name',
  password: 'Password',
  fromName: 'Sender name',
  fromAddress: 'Sender address',
  replyTo: 'Reply-to address',
}

function valuesOf(view: EmailSettingsView): Values {
  return {
    host: view.host ?? '',
    port: String(view.port),
    security: view.security,
    username: view.username ?? '',
    password: '',
    fromName: view.fromName ?? '',
    fromAddress: view.fromAddress ?? '',
    replyTo: view.replyTo ?? '',
  }
}

const fieldId = (key: string) => `email-${key}`

export function EmailSettingsForm({ initial }: { initial: EmailSettingsView }) {
  const viewOnly = useViewOnly()
  const router = useRouter()
  const [view, setView] = React.useState(initial)
  const [values, setValues] = React.useState<Values>(() => valuesOf(initial))
  const [clearPassword, setClearPassword] = React.useState(false)
  const [errors, setErrors] = React.useState<Partial<Record<string, string>>>({})
  const [general, setGeneral] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const summaryRef = React.useRef<HTMLDivElement>(null)

  const locked = (field: EmailField) => view.locked[field]
  const set = (key: keyof Values, value: string) => {
    setValues((current) => {
      const next = { ...current, [key]: value }
      // Picking an encryption suggests its usual port, unless a custom one was typed.
      if (key === 'security' && !locked('port') && Object.values(DEFAULT_PORT).includes(current.port)) next.port = DEFAULT_PORT[value] ?? current.port
      return next
    })
    setSaved(null)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending || viewOnly) return
    setErrors({})
    setGeneral(null)
    setSaved(null)
    startTransition(async () => {
      const input: Record<string, unknown> = {}
      for (const key of ['host', 'port', 'security', 'username', 'fromName', 'fromAddress', 'replyTo'] as const) {
        if (!locked(key)) input[key] = values[key]
      }
      if (!locked('password')) {
        if (clearPassword) input.clearPassword = true
        else if (values.password) input.password = values.password
      }
      const result = await saveEmailSettingsAction(input)
      if (result.ok) {
        setView(result.data)
        setValues(valuesOf(result.data))
        setClearPassword(false)
        // The test email below reads "ready" from the page: render it again.
        router.refresh()
        setSaved(result.data.ready ? 'Saved. The site can send email; try a test email below.' : 'Saved. Email is not ready yet: see what is missing above.')
        return
      }
      setErrors(result.fieldErrors ?? {})
      setGeneral(result.fieldErrors ? null : result.error)
      requestAnimationFrame(() => summaryRef.current?.focus())
    })
  }

  const errorEntries = Object.entries(errors).filter(([, message]) => message) as Array<[string, string]>

  const describedBy = (key: string) => [`${fieldId(key)}-hint`, errors[key] ? `${fieldId(key)}-error` : false].filter(Boolean).join(' ')

  const hint = (key: EmailField, content: React.ReactNode) => (
    <FieldDescription id={`${fieldId(key)}-hint`}>
      {locked(key) ? (
        <>
          Set on the server by <code>{locked(key)}</code>, so it cannot be changed here.
        </>
      ) : (
        content
      )}
    </FieldDescription>
  )
  const error = (key: string) =>
    errors[key] ? (
      <p id={`${fieldId(key)}-error`} className="text-sm text-destructive">
        {errors[key]}
      </p>
    ) : null

  const text = (key: Exclude<keyof Values, 'security' | 'password'>, opts: { type?: string; hint: React.ReactNode; inputMode?: 'numeric' }) => (
    <Field data-invalid={errors[key] ? true : undefined}>
      <FieldLabel htmlFor={fieldId(key)}>{LABELS[key]}</FieldLabel>
      {hint(key, opts.hint)}
      <Input
        id={fieldId(key)}
        type={opts.type ?? 'text'}
        inputMode={opts.inputMode}
        autoComplete="off"
        spellCheck={false}
        value={values[key]}
        readOnly={Boolean(locked(key))}
        onChange={(event) => set(key, event.target.value)}
        aria-invalid={Boolean(errors[key])}
        aria-describedby={describedBy(key)}
      />
      {error(key)}
    </Field>
  )

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Sending email</CardTitle>
            {view.plugin?.ready ? (
              <Badge variant="secondary">Sent by a plugin</Badge>
            ) : view.ready ? (
              <Badge>
                <FiCheckCircle aria-hidden />
                Ready
              </Badge>
            ) : (
              <Badge variant="destructive">
                <FiAlertTriangle aria-hidden />
                Not set up
              </Badge>
            )}
          </div>
          <CardDescription>
            {view.plugin?.ready ? (
              <>
                The plugin <code>{view.plugin.name}</code> sends the site’s email, so the settings below are not used while it is set up.
              </>
            ) : view.ready ? (
              'The site sends password reset links and form notifications through this SMTP server.'
            ) : (
              'The site sends no email until this is set up, so people cannot ask for a reset link by email. An admin can still make one on the Users screen.'
            )}
          </CardDescription>
        </CardHeader>
        {!view.ready && view.problems.length ? (
          <CardContent>
            <ul className="list-disc pl-5 text-sm">
              {view.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </CardContent>
        ) : null}
      </Card>

      <form noValidate aria-label="Email settings" onSubmit={submit} className="flex flex-col gap-6">
        {errorEntries.length || general ? (
          <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-lg border border-destructive p-3 text-sm outline-none">
            <p className="font-medium">The email settings could not be saved</p>
            {general ? <p className="mt-1">{general}</p> : null}
            {errorEntries.length ? (
              <ul className="mt-1 list-disc pl-5">
                {errorEntries.map(([key, message]) => (
                  <li key={key}>
                    <a
                      href={`#${fieldId(key)}`}
                      className="underline underline-offset-4"
                      onClick={(event) => {
                        event.preventDefault()
                        document.getElementById(fieldId(key))?.focus()
                      }}
                    >
                      {LABELS[key as keyof Values] ?? key}: {message}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <ViewOnlyFieldset className="flex flex-col gap-6">
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 font-semibold">Server</legend>
            <FieldGroup>
              {text('host', { hint: 'From your email provider, for example smtp.example.com.' })}
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <Field data-invalid={errors.security ? true : undefined}>
                  <FieldLabel id={`${fieldId('security')}-label`}>{LABELS.security}</FieldLabel>
                  {hint('security', 'What your provider asks for. STARTTLS on port 587 is the most common.')}
                  <Select
                    items={SECURITY_ITEMS}
                    value={values.security}
                    onValueChange={(value) => set('security', String(value ?? 'starttls'))}
                    disabled={Boolean(locked('security')) || viewOnly}
                  >
                    <SelectTrigger
                      id={fieldId('security')}
                      aria-labelledby={`${fieldId('security')}-label`}
                      aria-describedby={describedBy('security')}
                      aria-invalid={Boolean(errors.security)}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SECURITY_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {error('security')}
                </Field>
                {text('port', { hint: '1 to 65535.', inputMode: 'numeric' })}
              </div>
            </FieldGroup>
          </fieldset>

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 font-semibold">Sign-in to the server</legend>
            <FieldGroup>
              {text('username', { hint: 'Leave blank if the server needs no sign-in.' })}
              <Field data-invalid={errors.password ? true : undefined}>
                <FieldLabel htmlFor={fieldId('password')}>{LABELS.password}</FieldLabel>
                {hint(
                  'password',
                  view.passwordUnreadable
                    ? 'The saved password can no longer be read (the site’s secret changed). Enter it again.'
                    : clearPassword
                      ? 'The saved password will be removed when you save.'
                      : view.passwordSet
                        ? 'A password is saved (it is never shown). Leave blank to keep it, or type a new one.'
                        : 'Stored encrypted, and never shown again.',
                )}
                <Input
                  id={fieldId('password')}
                  type="password"
                  autoComplete="new-password"
                  value={values.password}
                  readOnly={Boolean(locked('password')) || clearPassword}
                  onChange={(event) => set('password', event.target.value)}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={describedBy('password')}
                />
                {error('password')}
                {view.passwordSet && !locked('password') && !viewOnly ? (
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={clearPassword}
                      onClick={() => {
                        setClearPassword((current) => !current)
                        set('password', '')
                      }}
                    >
                      {clearPassword ? 'Keep the saved password' : 'Remove the saved password'}
                    </Button>
                  </div>
                ) : null}
              </Field>
            </FieldGroup>
          </fieldset>

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 font-semibold">Sender</legend>
            <FieldGroup>
              {text('fromName', { hint: 'The name people see, for example the site’s name.' })}
              {text('fromAddress', { type: 'email', hint: 'Must be an address your provider lets you send from (often on a verified domain).' })}
              {text('replyTo', { type: 'email', hint: 'Optional: where replies go, if not to the sender address.' })}
            </FieldGroup>
          </fieldset>
        </ViewOnlyFieldset>

        {viewOnly ? null : (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" aria-disabled={pending || undefined}>
              {pending ? 'Saving…' : 'Save email settings'}
            </Button>
            <p role="status" aria-live="polite" className="text-sm">
              {saved}
            </p>
          </div>
        )}
      </form>
    </div>
  )
}
