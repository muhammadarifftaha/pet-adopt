'use client'

import { useViewOnly, ViewOnlyFieldset } from '@/components/admin/view-only'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React from 'react'
import { FiMoon, FiRotateCcw, FiSun } from 'react-icons/fi'

import { ErrorSummary } from '@/components/admin/ErrorSummary'
import { useUnsavedChanges } from '@/components/admin/use-unsaved-changes'
import type { ThemePreviewMessage } from '@/components/site/ThemePreviewBridge'
import { Badge } from '@pet-adopt/ui/components/badge'
import { Button, buttonVariants } from '@pet-adopt/ui/components/button'
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@pet-adopt/ui/components/field'
import { Input } from '@pet-adopt/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pet-adopt/ui/components/select'
import {
  BUTTON_OPTIONS,
  DENSITY_OPTIONS,
  FONT_OPTIONS,
  PRESETS,
  PRESET_OPTIONS,
  RADIUS_OPTIONS,
  SHADOW_OPTIONS,
  TEXT_SIZE_OPTIONS,
  contrastProblem,
  themeCss,
  type Mode,
  type PresetKey,
} from '@/lib/theme'
import { callAction } from '@/lib/admin/call-action'
import { cn } from '@/lib/utils'
import { activateThemeAction, updateThemeAction } from '@/server/actions/themes'
import type { ThemeRecord } from '@/server/types'

import { COLOR_FIELDS, presetLabel, resolved, themeInput, type ColorKey, type CustomTheme } from './theme-utils'

// Edit one of the owner's themes, with a live preview of real blocks beside the form. Every value
// is optional: unset means "as the base preset". The preview is the same CSS visitors get
// (resolveTheme + themeCss), sent to the preview page (/edit/theme-preview) as the form changes.
// Readability is checked as you type with the server's own rule (contrastProblem).

type StyleKey = 'headingFont' | 'bodyFont' | 'textSize' | 'radius' | 'button' | 'shadow' | 'density'
const HEX = /^#[0-9a-f]{6}$/i

const STYLE_FIELDS: Array<{ group: 'type' | 'shape'; key: StyleKey; label: string; options: readonly { value: string; label: string }[] }> = [
  { group: 'type', key: 'headingFont', label: 'Heading font', options: FONT_OPTIONS },
  { group: 'type', key: 'bodyFont', label: 'Body font', options: FONT_OPTIONS },
  { group: 'type', key: 'textSize', label: 'Text size', options: TEXT_SIZE_OPTIONS },
  { group: 'shape', key: 'radius', label: 'Corners', options: RADIUS_OPTIONS },
  { group: 'shape', key: 'button', label: 'Buttons', options: BUTTON_OPTIONS },
  { group: 'shape', key: 'shadow', label: 'Shadows', options: SHADOW_OPTIONS },
  { group: 'shape', key: 'density', label: 'Spacing', options: DENSITY_OPTIONS },
]

const fieldId = (name: string) => `theme-${name.replace(/\./g, '-')}`

/** The server names theme fields `customTheme.<key>`; the form's ids leave out the prefix. */
const errorFieldId = (key: string) => fieldId(key.replace(/^customTheme\./, ''))

/** A readable name for a field the server reported, for the error summary. */
function errorLabel(key: string): string {
  if (key === 'name') return 'Name'
  if (key === 'base') return 'Based on'
  const [, first, second] = key.split('.')
  const style = STYLE_FIELDS.find((f) => f.key === first)
  if (style && !second) return style.label
  if ((first === 'light' || first === 'dark') && second) {
    const colours = first === 'light' ? 'Light colours' : 'Dark colours'
    if (second === 'text') return `${colours}: readability`
    const color = COLOR_FIELDS.find((c) => c.key === second)
    return color ? `${color.label} (${colours.toLowerCase()})` : colours
  }
  return key
}

/** The base preset's own choice for a style key, for the "Preset default (...)" option. */
const presetChoice = (base: string, key: StyleKey): string | undefined =>
  base in PRESETS ? (PRESETS[base as PresetKey] as Record<StyleKey, string>)[key] : undefined

export function ThemeEditor({ theme, isActive }: { theme: ThemeRecord; isActive: boolean }) {
  // View-only roles (audit) see the theme's settings and preview; the fields are off and there is no Save.
  const viewOnly = useViewOnly()
  const router = useRouter()
  const initial = React.useMemo(() => JSON.stringify({ name: theme.name, base: theme.base, settings: theme.settings }), [theme])
  const [name, setName] = React.useState(theme.name)
  const [base, setBase] = React.useState(theme.base)
  const [settings, setSettings] = React.useState<CustomTheme>(theme.settings ?? {})
  const [mode, setMode] = React.useState<Mode>('light')
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [general, setGeneral] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  // After a failed save, focus moves to the error summary (it is on screen by the time this runs).
  const summaryRef = React.useRef<HTMLDivElement>(null)
  const [focusTick, setFocusTick] = React.useState(0)
  React.useEffect(() => {
    if (focusTick > 0) summaryRef.current?.focus()
  }, [focusTick])
  const summaryItems = Object.entries(errors).map(([key, message]) => ({ name: key, label: errorLabel(key), message }))

  const dirty = JSON.stringify({ name, base, settings }) !== initial
  const { dialog: leaveDialog, allowNavigation } = useUnsavedChanges(dirty)

  const input = themeInput(base, settings)
  const presetTheme = resolved(base, {})
  const problems = { light: contrastProblem(input, 'light'), dark: contrastProblem(input, 'dark') }

  // Send the draft to the preview whenever it, or the mode, changes, and when the preview loads.
  const css = themeCss(resolved(base, settings))
  const send = React.useCallback(() => {
    const message: ThemePreviewMessage = { type: 'pet-adopt-theme-preview', css, mode }
    iframeRef.current?.contentWindow?.postMessage(message, window.location.origin)
  }, [css, mode])
  React.useEffect(() => {
    send()
  }, [send])
  React.useEffect(() => {
    const onReady = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.type === 'pet-adopt-theme-preview-ready') send()
    }
    window.addEventListener('message', onReady)
    return () => window.removeEventListener('message', onReady)
  }, [send])

  const setStyle = (key: StyleKey, value: string | null) =>
    setSettings((prev) => {
      const next = { ...prev } as Record<string, unknown>
      if (value) next[key] = value
      else delete next[key]
      return next as CustomTheme
    })

  const setColor = (m: Mode, key: ColorKey, value: string | null) =>
    setSettings((prev) => {
      const set = { ...((prev[m] ?? {}) as Record<string, string | null>) }
      if (value) set[key] = value.toLowerCase()
      else delete set[key]
      return { ...prev, [m]: set } as CustomTheme
    })

  const save = async (andUse: boolean) => {
    if (saving) return
    setSaving(true)
    setGeneral(null)
    setErrors({})
    // callAction: a call that never arrives (network, redeploy) becomes a message, not a stuck "Saving…".
    const result = await callAction(updateThemeAction(theme.id, { name: name.trim(), base, customTheme: settings }))
    if (!result.ok) {
      setSaving(false)
      setErrors(result.fieldErrors ?? {})
      setGeneral(result.fieldErrors ? null : result.error)
      setFocusTick((tick) => tick + 1)
      return
    }
    if (andUse) {
      const used = await callAction(activateThemeAction({ themeId: theme.id }))
      if (!used.ok) {
        setSaving(false)
        setGeneral(used.error)
        setFocusTick((tick) => tick + 1)
        return
      }
    }
    setSaving(false)
    setStatus(andUse ? 'Saved. The whole site now uses this theme.' : isActive ? 'Saved. The site is updated.' : 'Saved.')
    allowNavigation()
    router.refresh()
  }

  const styleSelect = (field: (typeof STYLE_FIELDS)[number]) => {
    const value = (settings as Record<string, unknown>)[field.key] as string | undefined
    const presetValue = field.options.find((o) => o.value === presetChoice(base, field.key))?.label ?? 'as designed'
    const items = [
      { value: null as string | null, label: `Preset default (${presetValue})` },
      ...field.options.map((o) => ({ value: o.value as string | null, label: o.label })),
    ]
    const id = fieldId(field.key)
    const error = errors[`customTheme.${field.key}`]
    return (
      <Field key={field.key} data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
        <Select items={items} value={value ?? null} onValueChange={(next) => setStyle(field.key, (next as string | null) ?? null)}>
          <SelectTrigger id={id} className="w-full" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value ?? 'default'} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error ? (
          <p id={`${id}-error`} className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </Field>
    )
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <form
        noValidate
        aria-label={`Edit theme ${theme.name}`}
        onSubmit={(event) => {
          event.preventDefault()
          void save(false)
        }}
        className="flex flex-col gap-6"
      >
        {general || summaryItems.length ? (
          <ErrorSummary
            ref={summaryRef}
            items={summaryItems}
            general={general}
            idOf={errorFieldId}
            failureTitle="The theme could not be saved"
            onSelect={(key) => document.getElementById(errorFieldId(key))?.focus()}
            className=""
          />
        ) : null}
        <ViewOnlyFieldset className="flex flex-col gap-6">

        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor={fieldId('name')}>
            Name<span className="font-normal text-muted-foreground"> (required)</span>
          </FieldLabel>
          <Input
            id={fieldId('name')}
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? `${fieldId('name')}-error` : undefined}
          />
          {errors.name ? (
            <p id={`${fieldId('name')}-error`} className="text-sm text-destructive">
              {errors.name}
            </p>
          ) : null}
        </Field>

        <Field>
          <FieldLabel htmlFor={fieldId('base')}>Based on</FieldLabel>
          <FieldDescription id={`${fieldId('base')}-description`}>Anything you have not changed comes from this preset.</FieldDescription>
          <Select items={PRESET_OPTIONS} value={base} onValueChange={(next) => next && setBase(String(next))}>
            <SelectTrigger id={fieldId('base')} className="w-full" aria-describedby={`${fieldId('base')}-description`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESET_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <FieldSet>
          <FieldLegend>Typography</FieldLegend>
          <div className="grid gap-4">{STYLE_FIELDS.filter((f) => f.group === 'type').map(styleSelect)}</div>
        </FieldSet>

        <FieldSet>
          <FieldLegend>Shape and spacing</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-2">{STYLE_FIELDS.filter((f) => f.group === 'shape').map(styleSelect)}</div>
        </FieldSet>

        {(['light', 'dark'] as const).map((m) => {
          const problem = errors[`customTheme.${m}.text`] ?? problems[m]
          return (
            <FieldSet key={m}>
              <FieldLegend>{m === 'light' ? 'Light colours' : 'Dark colours'}</FieldLegend>
              <FieldDescription>Colours you leave alone come from {presetLabel(base)}.</FieldDescription>
              {/* Checked as you type, with the same rule the server applies when saving. */}
              <p id={fieldId(`${m}.text`)} tabIndex={-1} role="status" className={cn('text-sm outline-none', problem ? 'font-medium text-destructive' : 'sr-only')}>
                {problem ?? `${m === 'light' ? 'Light' : 'Dark'} colours are easy to read.`}
              </p>
              <div className="grid gap-4">
                {COLOR_FIELDS.map((color) => {
                  const own = ((settings[m] ?? {}) as Record<string, string | null | undefined>)[color.key] ?? null
                  return (
                    <ColorField
                      key={color.key}
                      id={fieldId(`${m}.${color.key}`)}
                      label={color.label}
                      hint={color.hint}
                      value={own}
                      fallback={presetTheme[m][color.token] ?? '#000000'}
                      error={errors[`customTheme.${m}.${color.key}`]}
                      onChange={(value) => setColor(m, color.key, value)}
                    />
                  )
                })}
              </div>
            </FieldSet>
          )
        })}

        </ViewOnlyFieldset>

        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          {viewOnly ? null : (
            <Button type="submit" aria-disabled={saving} className={cn(saving && 'opacity-50')}>
              {saving ? 'Saving…' : 'Save theme'}
            </Button>
          )}
          {viewOnly ? (isActive ? <Badge>In use on the site</Badge> : null) : !isActive ? (
            <Button type="button" variant="outline" aria-disabled={saving} onClick={() => void save(true)}>
              Save and use on the site
            </Button>
          ) : (
            <Badge>In use on the site</Badge>
          )}
          <Link href="/admin/theme" className={buttonVariants({ variant: 'ghost' })}>
            Back to themes
          </Link>
          <p role="status" aria-live="polite" className="text-sm">
            {dirty ? '' : status}
          </p>
        </div>
        {leaveDialog}
      </form>

      <section aria-labelledby="theme-preview-heading" className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-4 xl:self-start">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="theme-preview-heading" className="text-sm font-semibold">
            Preview
          </h2>
          <div role="group" aria-label="Preview colours" className="flex items-center gap-1 rounded-md border p-0.5">
            {(['light', 'dark'] as const).map((value) => (
              <Button key={value} type="button" size="xs" variant={mode === value ? 'secondary' : 'ghost'} aria-pressed={mode === value} onClick={() => setMode(value)}>
                {value === 'light' ? <FiSun aria-hidden /> : <FiMoon aria-hidden />}
                {value === 'light' ? 'Light' : 'Dark'}
              </Button>
            ))}
          </div>
        </div>
        {/* A real page in this theme. It updates as you edit; nothing is saved until you save. */}
        <iframe
          ref={iframeRef}
          src="/edit/theme-preview"
          title={`Preview of the theme ${name || theme.name}, ${mode} colours`}
          onLoad={send}
          className="h-[75vh] w-full rounded-lg border bg-background"
        />
      </section>
    </div>
  )
}

/** A colour: the theme's own value, or the preset's when unset, with a picker and a hex field. */
function ColorField({
  id,
  label,
  hint,
  value,
  fallback,
  error,
  onChange,
}: {
  id: string
  label: string
  hint: string
  value: string | null
  fallback: string
  error?: string
  onChange: (value: string | null) => void
}) {
  const shown = value ?? fallback
  const [text, setText] = React.useState(shown)
  const [synced, setSynced] = React.useState(shown)
  // Text that was not a colour code when the person left the box: the box went back to the colour
  // in use, and this says why.
  const [rejected, setRejected] = React.useState<string | null>(null)
  // Follow outside changes (picker, reset, a different base preset) without an effect.
  if (synced !== shown) {
    setSynced(shown)
    setText(shown)
    setRejected(null)
  }
  const hexId = `${id}-hex`
  const hexProblemId = `${hexId}-problem`
  const textInvalid = text !== '' && !HEX.test(text)
  // Only a colour code changes the theme, so the person is told while the text is not one, and
  // again if they leave the box with it (WCAG 3.3.1: not by the red outline alone).
  const hexProblem = textInvalid
    ? `Use # and six digits or letters a to f, such as #1a2b3c. Until then the colour stays ${shown}.`
    : rejected !== null
      ? `${rejected === '' ? 'The box was empty' : `“${rejected}” is not a colour code`}, so the colour stays ${shown}.`
      : ''
  const describedBy = [`${id}-description`, error ? `${id}-error` : ''].filter(Boolean).join(' ')
  const hexDescribedBy = [describedBy, hexProblem ? hexProblemId : ''].filter(Boolean).join(' ')
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <FieldDescription id={`${id}-description`}>
        {hint}
        {value ? '' : ' Using the preset colour.'}
      </FieldDescription>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="color"
          value={HEX.test(shown) ? shown : '#000000'}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={describedBy}
          className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
        />
        <label htmlFor={hexId} className="sr-only">
          {label}, hex code
        </label>
        <Input
          id={hexId}
          value={text}
          maxLength={7}
          spellCheck={false}
          className="w-28 font-mono"
          aria-invalid={Boolean(error) || textInvalid}
          aria-describedby={hexDescribedBy}
          onChange={(event) => {
            const next = event.target.value.trim()
            setText(next)
            setRejected(null)
            if (HEX.test(next)) onChange(next)
          }}
          onBlur={() => {
            // Leaving the box with something that is not a colour: show the colour that will be
            // saved again, so the box never claims a value the theme does not have.
            if (text !== shown && !HEX.test(text)) {
              setRejected(text)
              setText(shown)
            }
          }}
        />
        {value ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            <FiRotateCcw aria-hidden />
            Use preset
            <span className="sr-only">colour for {label}</span>
          </Button>
        ) : null}
      </div>
      {hexProblem ? (
        <p id={hexProblemId} className="text-sm text-destructive">
          {hexProblem}
        </p>
      ) : null}
      {/* Focus has moved on when the box goes back, so say it politely. Always in the page (and not
          display:none), so screen readers notice the change. */}
      <p aria-live="polite" className="sr-only">
        {rejected !== null && !textInvalid ? hexProblem : ''}
      </p>
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Field>
  )
}
