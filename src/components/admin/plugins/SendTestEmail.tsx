'use client'

import React from 'react'
import { FiSend } from 'react-icons/fi'

import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { sendTestEmailAction } from '@/server/actions/email'

// "Send a test email" on the email plugin's page: proves the setup works end to end. Starts with
// the admin's own address. The result is announced; a failure shows the provider's reason.

export function SendTestEmail({ defaultTo, disabled }: { defaultTo: string; disabled: boolean }) {
  const [to, setTo] = React.useState(defaultTo)
  const [error, setError] = React.useState<string | null>(null)
  const [sent, setSent] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (pending || disabled) return
    setError(null)
    setSent(null)
    startTransition(async () => {
      const result = await sendTestEmailAction(to)
      if (result.ok) setSent(`Sent to ${result.data.to}. Check that inbox (and its spam folder).`)
      else setError(result.fieldErrors?.to ?? result.error)
    })
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3" aria-labelledby="test-email-heading">
      <h3 id="test-email-heading" className="font-semibold">
        Send a test email
      </h3>
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor="test-email-to">Send to</FieldLabel>
        <FieldDescription id="test-email-to-description">
          {disabled ? 'Available once the setup above is finished.' : 'A short message saying the site can send email. Up to 5 every 15 minutes.'}
        </FieldDescription>
        <div className="flex flex-wrap gap-2">
          <Input
            id="test-email-to"
            type="email"
            autoComplete="email"
            value={to}
            onChange={(event) => {
              setTo(event.target.value)
              setError(null)
            }}
            readOnly={disabled}
            aria-invalid={Boolean(error)}
            aria-describedby={`test-email-to-description${error ? ' test-email-to-error' : ''}`}
            className="max-w-sm"
          />
          {/* aria-disabled, not disabled: it stays focusable and its reason is read out. */}
          <Button type="submit" aria-disabled={disabled || pending} aria-describedby={disabled ? 'test-email-to-description' : undefined}>
            <FiSend aria-hidden />
            {pending ? 'Sending…' : 'Send test email'}
          </Button>
        </div>
        <FieldError id="test-email-to-error" errors={error ? [{ message: error }] : []} />
      </Field>
      <p role="status" aria-live="polite" className="text-sm">
        {sent}
      </p>
    </form>
  )
}
