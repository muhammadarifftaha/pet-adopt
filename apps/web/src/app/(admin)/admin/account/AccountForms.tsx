'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import React from 'react'
import { Controller, useForm, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form'

import { Button } from '@pet-adopt/ui/components/button'
import { Card, CardContent, CardFooter, CardHeader } from '@pet-adopt/ui/components/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@pet-adopt/ui/components/field'
import { Input } from '@pet-adopt/ui/components/input'
import { changePasswordSchema, profileSchema, type ChangePasswordSchemaType, type ProfileSchemaType } from '@/lib/zod-schema/auth'
import { changePasswordAction, updateProfileAction } from '@/server/actions/auth'
import type { SessionUser } from '@/server/types'

// The Account page's own forms, styled like the sign-in forms:
//  - Your name: `updateProfileAction({ name })`; the header shows the new name after saving.
//  - Change password: `changePasswordAction({ currentPassword, newPassword })`, which signs you out
//    on every other device. The server is the authority on the rules (minimum length: 12 in
//    production, 8 in development) and limits wrong current passwords like a sign-in.
// Server errors are put on their fields; anything else shows above the form. Success is announced in
// a status line.

type Failure = { ok: false; error: string; fieldErrors?: Record<string, string> }

/** Puts a failed action's messages on the form: field errors on their fields, the rest on top. */
function showFailure<T extends FieldValues>(form: UseFormReturn<T>, failure: Failure, fields: Path<T>[]) {
  let placed = false
  for (const [name, message] of Object.entries(failure.fieldErrors ?? {})) {
    if ((fields as string[]).includes(name)) {
      form.setError(name as Path<T>, { message })
      placed = true
    }
  }
  if (!placed) form.setError('root', { message: failure.error })
}

function RootError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  )
}

export function AccountForms({ user, minPasswordLength }: { user: SessionUser; minPasswordLength: number }) {
  return (
    <>
      <NameForm user={user} />
      <PasswordForm user={user} minLength={minPasswordLength} />
    </>
  )
}

function NameForm({ user }: { user: SessionUser }) {
  const router = useRouter()
  const [saved, setSaved] = React.useState(false)
  const form = useForm<ProfileSchemaType>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: user.name },
  })

  const onSubmit = async (values: ProfileSchemaType) => {
    setSaved(false)
    const result = await updateProfileAction({ name: values.name })
    if (!result.ok) return showFailure(form, result, ['name'])
    form.reset({ name: values.name.trim() })
    setSaved(true)
    // The header and the user menu show the name: read it again.
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold">Your name</h2>
        <p className="text-sm text-muted-foreground">Shown in the admin and the activity log. Your email ({user.email}) is changed by an admin.</p>
      </CardHeader>
      <CardContent>
        <form id="account-name-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <RootError message={form.formState.errors.root?.message} />
            <Controller
              name="name"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="account-name">Name</FieldLabel>
                  <Input id="account-name" autoComplete="name" maxLength={80} aria-invalid={fieldState.invalid} {...field} />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-end gap-3">
        <p role="status" className="mr-auto text-sm">
          {saved ? 'Your name is saved.' : ''}
        </p>
        <Button type="submit" form="account-name-form" aria-disabled={form.formState.isSubmitting || !form.formState.isDirty || undefined}>
          {form.formState.isSubmitting ? 'Saving…' : 'Save name'}
        </Button>
      </CardFooter>
    </Card>
  )
}

function PasswordForm({ user, minLength }: { user: SessionUser; minLength: number }) {
  const [saved, setSaved] = React.useState(false)
  const form = useForm<ChangePasswordSchemaType>({
    resolver: zodResolver(changePasswordSchema(minLength)),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  })

  const onSubmit = async (values: ChangePasswordSchemaType) => {
    setSaved(false)
    const result = await changePasswordAction({ currentPassword: values.currentPassword, newPassword: values.newPassword })
    if (!result.ok) return showFailure(form, result, ['currentPassword', 'newPassword'])
    form.reset()
    setSaved(true)
  }

  const password = (name: 'currentPassword' | 'newPassword' | 'confirm', label: string, autoComplete: string, hint?: string) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`account-${name}`}>{label}</FieldLabel>
          <Input
            id={`account-${name}`}
            type="password"
            autoComplete={autoComplete}
            aria-invalid={fieldState.invalid}
            aria-describedby={hint ? `account-${name}-hint` : undefined}
            {...field}
          />
          {hint ? <FieldDescription id={`account-${name}-hint`}>{hint}</FieldDescription> : null}
          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  )

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold">Change password</h2>
        <p className="text-sm text-muted-foreground">Saving signs you out on every other device. This one stays signed in.</p>
      </CardHeader>
      <CardContent>
        <form id="account-password-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          {/* For password managers: which account the new password belongs to. */}
          <input type="email" name="username" autoComplete="username" value={user.email} readOnly hidden />
          <FieldGroup>
            <RootError message={form.formState.errors.root?.message} />
            {password('currentPassword', 'Current password', 'current-password')}
            {password('newPassword', 'New password', 'new-password', `At least ${minLength} characters.`)}
            {password('confirm', 'Repeat new password', 'new-password')}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-end gap-3">
        <p role="status" className="mr-auto text-sm">
          {saved ? 'Your password is changed. Other devices are signed out.' : ''}
        </p>
        <Button type="submit" form="account-password-form" aria-disabled={form.formState.isSubmitting || undefined}>
          {form.formState.isSubmitting ? 'Changing…' : 'Change password'}
        </Button>
      </CardFooter>
    </Card>
  )
}
