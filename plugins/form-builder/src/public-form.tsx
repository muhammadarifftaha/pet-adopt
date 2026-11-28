'use client'

import React, { useId, useRef, useState } from 'react'

import { submitFormAction } from './actions'
import { CAPTCHA_INFO } from './captcha-providers'
import { CaptchaWidget, type CaptchaHandle } from './captcha-widget'
import type { PublicField as FormField } from './fields'
import type { PublicForm as PublicFormData } from './server'

// A form as visitors fill it in, drawn by the Form block (src/block.tsx). Plain HTML styled by the
// block's own CSS (src/block-css.ts, `.fb-form-*`), because the page builder's canvas has no Tailwind.
//  - Every control has a visible label and a "(required)" mark; hints and errors are tied to it.
//  - A failed send shows an error summary that takes focus and links to each field.
//  - The send button uses aria-disabled while sending, so focus stays on it.
//  - `preview` (the page builder) shows the form but never sends it.
//  - `website` is a honeypot: hidden from people and screen readers, so only bots fill it in.
//  - When the form builder's spam protection is on (`form.captcha`), its widget sits above the button
//    and its token goes with the answers (checked on the server). The preview shows a placeholder
//    instead, so the page builder never loads a captcha service.

type Errors = Record<string, string>

export function PublicForm({
  form,
  preview = false,
  privacy = null,
}: {
  form: PublicFormData
  preview?: boolean
  /** The live privacy policy, linked under the button (notice at the point of collection). */
  privacy?: { title: string; href: string } | null
}) {
  const base = `form-${form.id}-${useId().replace(/:/g, '')}`
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const summaryRef = useRef<HTMLDivElement>(null)
  const sentRef = useRef<HTMLParagraphElement>(null)
  const captchaRef = useRef<CaptchaHandle>(null)

  const inputId = (field: FormField) => `${base}-${field.id}`
  // Radio and checkbox groups: the summary link goes to the first option.
  const focusId = (field: FormField) => (field.type === 'choice' && field.display !== 'dropdown') || field.type === 'checkboxes' ? `${inputId(field)}-0` : inputId(field)

  if (sent) {
    return (
      <p ref={sentRef} className="fb-form-success" role="status" tabIndex={-1}>
        {sent}
      </p>
    )
  }

  if (!form.isOpen) return <p className="fb-form-closed">This form is not accepting responses right now.</p>

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (preview || sending) return
    const data = new FormData(event.currentTarget)
    const answers: Record<string, unknown> = {}
    for (const field of form.fields) {
      if (field.type === 'checkboxes') answers[field.id] = data.getAll(field.id)
      else if (field.type === 'checkbox') answers[field.id] = data.get(field.id) === 'on'
      else answers[field.id] = data.get(field.id) ?? ''
    }
    setSending(true)
    try {
      let captchaToken: string | null = null
      if (form.captcha) {
        captchaToken = (await captchaRef.current?.getToken()) ?? null
        if (!captchaToken) {
          setErrors({})
          setFormError('Please complete the spam check above the button, then send the form.')
          requestAnimationFrame(() => summaryRef.current?.focus())
          return
        }
      }
      const result = await submitFormAction(form.id, answers, data.get('website') ?? '', captchaToken)
      // A token works once: get a fresh check ready for the next attempt.
      if (!result.ok) captchaRef.current?.reset()
      if (result.ok) {
        setSent(result.data.message)
        requestAnimationFrame(() => sentRef.current?.focus())
        return
      }
      setErrors(result.fieldErrors ?? {})
      setFormError(result.error)
    } catch {
      captchaRef.current?.reset()
      setErrors({})
      setFormError('Your answers could not be sent. Check your connection and try again.')
    } finally {
      setSending(false)
    }
    requestAnimationFrame(() => summaryRef.current?.focus())
  }

  const errorList = form.fields.filter((field) => errors[field.id])

  return (
    <form className="fb-form" onSubmit={onSubmit} noValidate aria-describedby={preview ? `${base}-preview` : undefined}>
      {preview && (
        <p id={`${base}-preview`} className="fb-form-note">
          Preview: the form works on the live page.
        </p>
      )}

      {formError && (
        <div ref={summaryRef} className="fb-form-summary" role="alert" tabIndex={-1}>
          <p>{errorList.length ? 'Please check these answers:' : formError}</p>
          {errorList.length > 0 && (
            <ul>
              {errorList.map((field) => (
                <li key={field.id}>
                  <a href={`#${focusId(field)}`}>
                    {field.label}: {errors[field.id]}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {form.fields.map((field) => (
        <Field key={field.id} field={field} id={inputId(field)} error={errors[field.id]} disabled={preview} />
      ))}

      {form.spamTrap ? (
        <div className="fb-form-hp" aria-hidden="true">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>
      ) : null}

      {form.captcha ? (
        preview ? (
          <p className="fb-form-note">Spam check ({CAPTCHA_INFO[form.captcha.provider].label}) appears here on the live page.</p>
        ) : (
          <CaptchaWidget ref={captchaRef} captcha={form.captcha} />
        )
      ) : null}

      <div className="fb-form-actions">
        <button type="submit" className="btn btn-primary" aria-disabled={preview || sending || undefined}>
          {sending ? 'Sending…' : form.submitLabel}
        </button>
      </div>
      {privacy ? (
        <p className="fb-form-privacy">
          We use your answers as described in our <a href={privacy.href}>{privacy.title}</a>.
        </p>
      ) : null}
    </form>
  )
}

function Field({ field, id, error, disabled }: { field: FormField; id: string; error?: string; disabled: boolean }) {
  const hintId = field.hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  const required = field.required ? <span className="fb-form-required"> (required)</span> : null
  const hint = field.hint ? (
    <p id={hintId} className="fb-form-hint">
      {field.hint}
    </p>
  ) : null
  const message = error ? (
    <p id={errorId} className="fb-form-error">
      {error}
    </p>
  ) : null
  const common = { name: field.id, disabled, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined }
  const invalid = error ? ' fb-form-has-error' : ''

  // Groups: a fieldset whose legend is the label.
  if ((field.type === 'choice' && field.display !== 'dropdown') || field.type === 'checkboxes') {
    const type = field.type === 'choice' ? 'radio' : 'checkbox'
    return (
      <fieldset className={`fb-form-field fb-form-group${invalid}`} aria-describedby={describedBy}>
        <legend className="fb-form-label">
          {field.label}
          {required}
        </legend>
        {hint}
        {message}
        <div className="fb-form-options">
          {(field.options ?? []).map((option, index) => (
            <label key={option} className="fb-form-option">
              <input type={type} id={`${id}-${index}`} name={field.id} value={option} disabled={disabled} aria-invalid={error ? true : undefined} />
              <span>{option}</span>
            </label>
          ))}
        </div>
      </fieldset>
    )
  }

  if (field.type === 'checkbox') {
    return (
      <div className={`fb-form-field fb-form-check${invalid}`}>
        <label className="fb-form-option" htmlFor={id}>
          <input type="checkbox" id={id} {...common} aria-required={field.required || undefined} />
          <span>
            {field.label}
            {required}
          </span>
        </label>
        {hint}
        {message}
      </div>
    )
  }

  const control =
    field.type === 'textarea' ? (
      <textarea id={id} rows={5} maxLength={5000} {...common} aria-required={field.required || undefined} />
    ) : field.type === 'source' ? (
      <select id={id} defaultValue="" {...common} aria-required={field.required || undefined}>
        <option value="">{field.choices?.length ? 'Choose…' : 'None available right now'}</option>
        {(field.choices ?? []).map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    ) : field.type === 'choice' ? (
      <select id={id} defaultValue="" {...common} aria-required={field.required || undefined}>
        <option value="">Choose…</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    ) : (
      <input
        id={id}
        {...common}
        aria-required={field.required || undefined}
        type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : field.type === 'date' ? 'date' : 'text'}
        inputMode={field.type === 'number' ? 'decimal' : undefined}
        autoComplete={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : undefined}
        maxLength={field.type === 'date' ? undefined : 300}
      />
    )

  return (
    <div className={`fb-form-field${invalid}`}>
      <label className="fb-form-label" htmlFor={id}>
        {field.label}
        {required}
      </label>
      {hint}
      {control}
      {message}
    </div>
  )
}
