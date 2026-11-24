'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React from 'react'
import { FiCheck, FiCopy, FiEdit2, FiPlus, FiTrash2 } from 'react-icons/fi'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PRESETS, PRESET_KEYS } from '@/lib/theme'
import {
  activateThemeAction,
  createThemeAction,
  deleteThemeAction,
} from '@/server/actions/themes'
import type { ThemeRecord } from '@/server/types'

import { ThemeSwatches } from './ThemeSwatches'
import { presetLabel, uniqueName } from './theme-utils'

// The Theme screen: the owner's saved themes and the built-in presets, side by side. Any of them
// can be used for the whole site; presets are read-only but can be copied into a new theme, and a
// saved theme can be edited, duplicated or deleted (except the one in use).

type Result = { ok: true } | { ok: false; error: string }

export function ThemeLibrary({
  themes,
  activeThemeId,
  preset,
}: {
  themes: ThemeRecord[]
  activeThemeId: number | null
  preset: string
}) {
  const router = useRouter()
  const [message, setMessage] = React.useState<{ text: string; isError: boolean; id: number } | null>(null)
  const [pending, startTransition] = React.useTransition()
  const names = themes.map((theme) => theme.name)

  const announce = (text: string, isError = false) => setMessage((prev) => ({ text, isError, id: (prev?.id ?? 0) + 1 }))

  const run = (action: () => Promise<Result>, done: string) =>
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        announce(done)
        router.refresh()
      } else {
        announce(result.error, true)
      }
    })

  /** Copies a preset or a theme into a new theme and opens it in the editor. */
  const copyInto = (input: { name: string; preset?: string; fromThemeId?: number }) =>
    startTransition(async () => {
      const result = await createThemeAction(input)
      if (result.ok) router.push(`/admin/theme/${result.data.id}`)
      else announce(result.fieldErrors?.name ?? result.error, true)
    })

  return (
    <div className="flex flex-col gap-8">
      <div aria-live="polite" className="min-h-6 text-sm">
        {message && !message.isError ? <p key={message.id}>{message.text}</p> : null}
      </div>
      {message?.isError ? (
        <p key={message.id} role="alert" className="-mt-6 text-sm text-destructive">
          {message.text}
        </p>
      ) : null}

      <section aria-labelledby="my-themes-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="my-themes-heading" className="text-lg font-semibold">
            Your themes
          </h2>
          <NewThemeDialog themes={themes} pending={pending} onCreate={copyInto} />
        </div>
        {themes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No themes of your own yet. Start one from a preset below with Customise, or with New theme.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {themes.map((theme) => {
              const active = theme.id === activeThemeId
              return (
                <li key={theme.id}>
                  <Card className="h-full">
                    <CardHeader className="flex flex-row items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold">{theme.name}</h3>
                        <p className="text-sm text-muted-foreground">Based on {presetLabel(theme.base)}</p>
                      </div>
                      {active ? <Badge>In use</Badge> : null}
                    </CardHeader>
                    <CardContent>
                      <ThemeSwatches base={theme.base} settings={theme.settings} />
                    </CardContent>
                    <CardFooter className="flex flex-wrap items-center gap-2">
                      {!active ? (
                        <Button
                          size="sm"
                          aria-disabled={pending}
                          onClick={() => !pending && run(() => activateThemeAction({ themeId: theme.id }), `“${theme.name}” is now used on the whole site.`)}
                        >
                          <FiCheck aria-hidden />
                          Use
                          <span className="sr-only">{theme.name}</span>
                        </Button>
                      ) : null}
                      <Link href={`/admin/theme/${theme.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                        <FiEdit2 aria-hidden />
                        Edit
                        <span className="sr-only">{theme.name}</span>
                      </Link>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-disabled={pending}
                        onClick={() => !pending && copyInto({ name: uniqueName(`${theme.name} copy`, names), fromThemeId: theme.id })}
                      >
                        <FiCopy aria-hidden />
                        Duplicate
                        <span className="sr-only">{theme.name}</span>
                      </Button>
                      {active ? null : (
                        <DeleteTheme theme={theme} pending={pending} onDelete={() => run(() => deleteThemeAction(theme.id), `“${theme.name}” deleted.`)} />
                      )}
                    </CardFooter>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="presets-heading" className="flex flex-col gap-4">
        <div>
          <h2 id="presets-heading" className="text-lg font-semibold">
            Built-in presets
          </h2>
          <p className="text-sm text-muted-foreground">Use one as it is, or customise a copy of it.</p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {PRESET_KEYS.map((key) => {
            const active = activeThemeId === null && preset === key
            return (
              <li key={key}>
                <Card className="h-full">
                  <CardHeader className="flex flex-row items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">{PRESETS[key].label}</h3>
                      <p className="text-sm text-muted-foreground">{PRESETS[key].description}</p>
                    </div>
                    {active ? <Badge>In use</Badge> : null}
                  </CardHeader>
                  <CardContent>
                    <ThemeSwatches base={key} />
                  </CardContent>
                  <CardFooter className="flex flex-wrap items-center gap-2">
                    {!active ? (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-disabled={pending}
                        onClick={() => !pending && run(() => activateThemeAction({ preset: key }), `${PRESETS[key].label} is now used on the whole site.`)}
                      >
                        <FiCheck aria-hidden />
                        Use
                        <span className="sr-only">{PRESETS[key].label}</span>
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      aria-disabled={pending}
                      onClick={() => !pending && copyInto({ name: uniqueName(`My ${PRESETS[key].label}`, names), preset: key })}
                    >
                      <FiEdit2 aria-hidden />
                      Customise
                      <span className="sr-only">a copy of {PRESETS[key].label}</span>
                    </Button>
                  </CardFooter>
                </Card>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

function DeleteTheme({ theme, pending, onDelete }: { theme: ThemeRecord; pending: boolean; onDelete: () => void }) {
  const [open, setOpen] = React.useState(false)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" aria-disabled={pending} />}>
        <FiTrash2 aria-hidden />
        Delete
        <span className="sr-only">{theme.name}</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{theme.name}”?</AlertDialogTitle>
          <AlertDialogDescription>The theme is removed for good. The site is not affected, as it does not use this theme.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
          >
            Delete theme
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function NewThemeDialog({
  themes,
  pending,
  onCreate,
}: {
  themes: ThemeRecord[]
  pending: boolean
  onCreate: (input: { name: string; preset?: string; fromThemeId?: number }) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [from, setFrom] = React.useState<string>('preset:sunrise')
  const [error, setError] = React.useState<string | null>(null)
  const items = [
    ...PRESET_KEYS.map((key) => ({ value: `preset:${key}`, label: `${PRESETS[key].label} (preset)` })),
    ...themes.map((theme) => ({ value: `theme:${theme.id}`, label: theme.name })),
  ]

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setError('Enter a name.')
      return
    }
    const [kind, value] = from.split(':')
    onCreate(kind === 'theme' ? { name: name.trim(), fromThemeId: Number(value) } : { name: name.trim(), preset: value })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button aria-disabled={pending} />}>
        <FiPlus aria-hidden />
        New theme
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New theme</DialogTitle>
            <DialogDescription>Start from a preset or one of your themes, then change anything you like.</DialogDescription>
          </DialogHeader>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="new-theme-name">
              Name<span className="font-normal text-muted-foreground"> (required)</span>
            </FieldLabel>
            <Input
              id="new-theme-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setError(null)
              }}
              maxLength={60}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'new-theme-name-error' : undefined}
            />
            <FieldError id="new-theme-name-error" errors={error ? [{ message: error }] : []} />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-theme-from">Start from</FieldLabel>
            <Select items={items} value={from} onValueChange={(value) => setFrom(String(value))}>
              <SelectTrigger id="new-theme-from" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button type="submit" aria-disabled={pending}>
              {pending ? 'Creating…' : 'Create and edit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
