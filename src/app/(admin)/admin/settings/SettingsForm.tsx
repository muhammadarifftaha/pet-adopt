'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React from 'react'
import { Controller, useFieldArray, useForm, type Control, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FiArrowDown, FiArrowUp, FiPlus, FiTrash2 } from 'react-icons/fi'

import { ErrorSummary, type SummaryItem } from '@/components/admin/pets/form/ErrorSummary'
import { MediaPickerDialog } from '@/components/admin/pets/form/MediaPickerDialog'
import { useUnsavedChanges } from '@/components/admin/useUnsavedChanges'
import { Button, buttonVariants } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { SOCIAL_PLATFORMS } from '@/lib/options'
import { cn } from '@/lib/utils'
import {
  settingsFieldInfo,
  settingsFormField,
  settingsFormSchema,
  settingsToFormValues,
  toSettingsInput,
  type SettingsFormValues,
  type SettingsTab,
} from '@/lib/zod-schema/settings'
import { updateSettingsAction } from '@/server/actions/settings'
import type { SiteSetting } from '@/server/types'

// The site settings (admin only): Brand, Contact and Navigation. The look of the site has its own
// screen (/admin/theme). Built like the pet and page forms for WCAG 2.2 AA: visible labels and
// "(required)", hints and errors tied with aria-describedby, tabs that count their errors, an error
// summary that takes focus and opens the right tab, list rows moved with buttons (announced), and
// aria-disabled on busy buttons. Unsaved edits survive reloads and leaving asks first.

type Values = SettingsFormValues
type Name = FieldPath<Values>

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'brand', label: 'Brand' },
  { id: 'contact', label: 'Contact' },
  { id: 'navigation', label: 'Navigation' },
]
const MAX_ROWS = 20

const fieldId = (name: string) => `settings-${name.replace(/\./g, '-')}`

function Required() {
  return <span className="font-normal text-muted-foreground"> (required)</span>
}

function describedBy(name: string, hasDescription: boolean, hasError: boolean) {
  const ids = [hasDescription ? `${fieldId(name)}-description` : null, hasError ? `${fieldId(name)}-error` : null].filter(Boolean)
  return ids.length ? ids.join(' ') : undefined
}

/** A text box or text area tied to one form value. */
function TextField({
  control,
  name,
  label,
  description,
  required,
  multiline,
  type = 'text',
  inputMode,
  autoComplete = 'off',
}: {
  control: Control<Values>
  name: Name
  label: string
  description?: string
  required?: boolean
  multiline?: boolean
  type?: string
  inputMode?: React.ComponentProps<'input'>['inputMode']
  autoComplete?: string
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const id = fieldId(name)
        const common = {
          id,
          ref: field.ref,
          name: field.name,
          value: (field.value as string) ?? '',
          onChange: field.onChange,
          onBlur: field.onBlur,
          'aria-invalid': fieldState.invalid,
          'aria-required': required || undefined,
          'aria-describedby': describedBy(name, Boolean(description), Boolean(fieldState.error)),
        }
        return (
          <Field data-invalid={fieldState.invalid || undefined}>
            <FieldLabel htmlFor={id}>
              {label}
              {required ? <Required /> : null}
            </FieldLabel>
            {description ? <FieldDescription id={`${id}-description`}>{description}</FieldDescription> : null}
            {multiline ? <Textarea rows={3} {...common} /> : <Input type={type} inputMode={inputMode} autoComplete={autoComplete} {...common} />}
            <FieldError id={`${id}-error`} errors={[fieldState.error]} />
          </Field>
        )
      }}
    />
  )
}

function LogoField({ control }: { control: Control<Values> }) {
  const [open, setOpen] = React.useState(false)
  const id = fieldId('logo')
  return (
    <Controller
      name="logo"
      control={control}
      render={({ field, fieldState }) => {
        const image = field.value
        return (
          <FieldSet id={id} data-invalid={fieldState.invalid || undefined} aria-describedby={`${id}-description${fieldState.error ? ` ${id}-error` : ''}`}>
            <FieldLegend variant="label">Logo</FieldLegend>
            <FieldDescription id={`${id}-description`}>Shown in the site header. Leave it empty to show the site name only.</FieldDescription>
            {image ? (
              <div className="flex items-center gap-3 rounded-lg border p-2">
                {/* Decorative here: the text beside it is the logo's description. */}
                <Image src={image.thumbnailUrl} alt="" width={72} height={72} className="size-[72px] shrink-0 rounded object-contain" />
                <p className="line-clamp-2 text-sm">{image.alt}</p>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" id={`${id}-choose`} ref={field.ref} onClick={() => setOpen(true)}>
                {image ? 'Change logo' : 'Choose logo'}
              </Button>
              {image ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    field.onChange(null)
                    requestAnimationFrame(() => document.getElementById(`${id}-choose`)?.focus())
                  }}
                >
                  Remove logo
                </Button>
              ) : null}
            </div>
            <FieldError id={`${id}-error`} errors={[fieldState.error]} />
            <MediaPickerDialog open={open} onOpenChange={setOpen} title="Choose the logo" max={1} onPick={(items) => field.onChange(items[0] ?? null)} />
          </FieldSet>
        )
      }}
    />
  )
}

/** Up, down and remove buttons for one row of a list. */
function RowButtons({
  index,
  count,
  what,
  onMove,
  onRemove,
}: {
  index: number
  count: number
  what: string
  onMove: (to: number) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-1 self-end pb-1">
      <Button type="button" variant="ghost" size="icon-sm" aria-disabled={index === 0} onClick={() => index > 0 && onMove(index - 1)}>
        <FiArrowUp aria-hidden />
        <span className="sr-only">Move {what} up</span>
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-disabled={index === count - 1} onClick={() => index < count - 1 && onMove(index + 1)}>
        <FiArrowDown aria-hidden />
        <span className="sr-only">Move {what} down</span>
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove}>
        <FiTrash2 aria-hidden />
        <span className="sr-only">Remove {what}</span>
      </Button>
    </div>
  )
}

export function SettingsForm({ settings }: { settings: SiteSetting }) {
  const router = useRouter()
  const initial = React.useMemo(() => settingsToFormValues(settings), [settings])
  const form = useForm<Values>({
    resolver: zodResolver(settingsFormSchema),
    values: initial,
    // When the page reloads after a save, fields being edited keep their text.
    resetOptions: { keepDirtyValues: true },
    mode: 'onBlur',
  })
  const { control, formState } = form
  const socials = useFieldArray({ control, name: 'socials' })
  const nav = useFieldArray({ control, name: 'nav' })
  const { dialog: leaveDialog } = useUnsavedChanges(formState.isDirty)

  const [tab, setTab] = React.useState<SettingsTab>('brand')
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [general, setGeneral] = React.useState<string | null>(null)
  const [summaryOpen, setSummaryOpen] = React.useState(false)
  const [focusTick, setFocusTick] = React.useState(0)
  const [listMessage, setListMessage] = React.useState('')
  const summaryRef = React.useRef<HTMLDivElement>(null)

  // Every error, flattened to dotted names ("nav.1.href"), in form order.
  const items: SummaryItem[] = []
  const walk = (value: unknown, path: string) => {
    if (!value || typeof value !== 'object') return
    const entry = value as { message?: unknown }
    if (typeof entry.message === 'string' && 'type' in (value as object)) {
      items.push({ name: path, label: settingsFieldInfo(path).label, message: entry.message })
      return
    }
    for (const [key, child] of Object.entries(value)) if (key !== 'ref') walk(child, path ? `${path}.${key}` : key)
  }
  walk(formState.errors, '')
  const errorsByTab = new Map<SettingsTab, number>()
  for (const item of items) {
    const owner = settingsFieldInfo(item.name).tab
    errorsByTab.set(owner, (errorsByTab.get(owner) ?? 0) + 1)
  }
  const showSummary = summaryOpen && (items.length > 0 || general !== null)

  React.useEffect(() => {
    if (focusTick > 0) summaryRef.current?.focus()
  }, [focusTick])

  function problems() {
    setSummaryOpen(true)
    setFocusTick((tick) => tick + 1)
  }

  function goTo(name: string) {
    setTab(settingsFieldInfo(name).tab)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const element = document.getElementById(fieldId(name))
        const selector = 'input, textarea, button, [role="combobox"]'
        const target = element?.matches(selector) ? element : element?.querySelector<HTMLElement>(selector)
        ;(target ?? element)?.focus()
      }),
    )
  }

  async function onValid(values: Values) {
    if (saving) return
    setSaving(true)
    setSaved(false)
    setGeneral(null)
    const result = await updateSettingsAction(toSettingsInput(values))
    setSaving(false)
    if (result.ok) {
      setSummaryOpen(false)
      form.reset(values)
      setSaved(true)
      router.refresh()
      return
    }
    const unplaced: string[] = []
    for (const [key, message] of Object.entries(result.fieldErrors ?? {})) {
      const name = settingsFormField(key)
      if (name.startsWith('customTheme') || name === 'theme' || name === 'primaryColor') unplaced.push(message)
      else form.setError(name as Name, { type: 'server', message })
    }
    setGeneral(result.fieldErrors ? (unplaced.length ? unplaced.join(' ') : null) : result.error)
    problems()
  }

  const move = (list: 'socials' | 'nav', from: number, to: number) => {
    ;(list === 'socials' ? socials : nav).move(from, to)
    setListMessage(`${list === 'socials' ? 'Social link' : 'Menu link'} ${from + 1} moved to position ${to + 1}.`)
    requestAnimationFrame(() => document.getElementById(fieldId(`${list}.${to}.${list === 'socials' ? 'url' : 'label'}`))?.focus())
  }

  const platformItems = SOCIAL_PLATFORMS.map((option) => ({ value: option.value as string, label: option.label as string }))

  return (
    <form noValidate aria-label="Site settings" onSubmit={form.handleSubmit(onValid, problems)}>
      {showSummary ? (
        <ErrorSummary ref={summaryRef} items={items} general={general} onSelect={goTo} idOf={fieldId} failureTitle="The settings could not be saved" />
      ) : null}
      {/* Announces list changes (moves, additions, removals). */}
      <p aria-live="polite" className="sr-only">
        {listMessage}
      </p>

      <Tabs value={tab} onValueChange={(value) => setTab(value as SettingsTab)}>
        <TabsList className="h-auto w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto">
          {TABS.map(({ id, label }) => {
            const count = errorsByTab.get(id) ?? 0
            return (
              <TabsTrigger key={id} value={id} className="h-auto flex-none px-3 py-1.5">
                {label}
                {count > 0 ? (
                  <>
                    <span aria-hidden="true" className="size-2 rounded-full bg-destructive" />
                    <span className="sr-only">
                      , {count} {count === 1 ? 'error' : 'errors'}
                    </span>
                  </>
                ) : null}
              </TabsTrigger>
            )
          })}
        </TabsList>

        <TabsContent value="brand" className="pt-4">
          <FieldGroup className="max-w-2xl">
            <TextField control={control} name="siteName" label="Site name" required description="Shown in the header, the browser tab and search results." />
            <TextField control={control} name="tagline" label="Tagline" description="A short line about your rescue, used on the homepage and in link previews." />
            <LogoField control={control} />
            <Controller
              name="allowModeToggle"
              control={control}
              render={({ field }) => (
                <Field orientation="horizontal">
                  <Checkbox
                    id={fieldId('allowModeToggle')}
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                    aria-describedby={`${fieldId('allowModeToggle')}-description`}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor={fieldId('allowModeToggle')}>Let visitors switch between light and dark</FieldLabel>
                    <FieldDescription id={`${fieldId('allowModeToggle')}-description`}>
                      Adds a light/dark button to the site and follows each visitor’s system setting. Turn it off to show the light colours only.
                    </FieldDescription>
                  </FieldContent>
                </Field>
              )}
            />
            <p className="text-sm text-muted-foreground">
              Colours, fonts and shapes are on the{' '}
              <Link href="/admin/theme" className="underline underline-offset-4">
                Theme
              </Link>{' '}
              screen.
            </p>
          </FieldGroup>
        </TabsContent>

        <TabsContent value="contact" className="pt-4">
          <FieldGroup className="max-w-2xl">
            <TextField
              control={control}
              name="whatsappNumber"
              label="WhatsApp number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              description="Where the WhatsApp buttons send messages. With the country code, for example +60 12-345 6789."
            />
            <TextField control={control} name="whatsappMessage" label="WhatsApp message" multiline description="The message visitors start with. {pet} is replaced by the pet's name." />
            <TextField control={control} name="address" label="Address" multiline description="Shown in Contact & map blocks. Line breaks are kept." />
            <TextField control={control} name="openingHours" label="Opening hours" multiline description="For example: Saturday and Sunday, 10am to 4pm." />

            <FieldSet>
              <FieldLegend>Social links</FieldLegend>
              <FieldDescription>Shown in the footer and in Social links blocks, in this order.</FieldDescription>
              {socials.fields.length === 0 ? <p className="text-sm text-muted-foreground">No social links yet.</p> : null}
              <ol className="flex flex-col gap-3">
                {socials.fields.map((row, index) => (
                  <li key={row.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
                    <Controller
                      name={`socials.${index}.platform`}
                      control={control}
                      render={({ field, fieldState }) => {
                        const id = fieldId(`socials.${index}.platform`)
                        return (
                          <Field data-invalid={fieldState.invalid || undefined}>
                            <FieldLabel htmlFor={id}>Platform</FieldLabel>
                            <Select items={platformItems} value={field.value} onValueChange={(value) => field.onChange(value ?? '')}>
                              <SelectTrigger
                                id={id}
                                ref={field.ref}
                                className="w-full"
                                aria-invalid={fieldState.invalid}
                                aria-describedby={fieldState.error ? `${id}-error` : undefined}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {platformItems.map((item) => (
                                  <SelectItem key={item.value} value={item.value}>
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FieldError id={`${id}-error`} errors={[fieldState.error]} />
                          </Field>
                        )
                      }}
                    />
                    <TextField control={control} name={`socials.${index}.url`} label="Link" type="url" inputMode="url" required />
                    <RowButtons
                      index={index}
                      count={socials.fields.length}
                      what={`social link ${index + 1}`}
                      onMove={(to) => move('socials', index, to)}
                      onRemove={() => {
                        socials.remove(index)
                        setListMessage(`Social link ${index + 1} removed.`)
                      }}
                    />
                  </li>
                ))}
              </ol>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  aria-disabled={socials.fields.length >= MAX_ROWS}
                  onClick={() => {
                    if (socials.fields.length >= MAX_ROWS) return
                    socials.append({ platform: 'instagram', url: '' }, { focusName: `socials.${socials.fields.length}.url` })
                    setListMessage('Social link added.')
                  }}
                >
                  <FiPlus aria-hidden />
                  Add social link
                </Button>
              </div>
            </FieldSet>
          </FieldGroup>
        </TabsContent>

        <TabsContent value="navigation" className="pt-4">
          <FieldGroup className="max-w-2xl">
            <FieldSet>
              <FieldLegend>Menu links</FieldLegend>
              <FieldDescription>The links in the site header, in this order. Use a path like /pets or a full https link.</FieldDescription>
              {nav.fields.length === 0 ? <p className="text-sm text-muted-foreground">No menu links yet.</p> : null}
              <ol className="flex flex-col gap-3">
                {nav.fields.map((row, index) => (
                  <li key={row.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <TextField control={control} name={`nav.${index}.label`} label="Link text" required />
                    <TextField control={control} name={`nav.${index}.href`} label="Goes to" required />
                    <RowButtons
                      index={index}
                      count={nav.fields.length}
                      what={`menu link ${index + 1}`}
                      onMove={(to) => move('nav', index, to)}
                      onRemove={() => {
                        nav.remove(index)
                        setListMessage(`Menu link ${index + 1} removed.`)
                      }}
                    />
                  </li>
                ))}
              </ol>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  aria-disabled={nav.fields.length >= MAX_ROWS}
                  onClick={() => {
                    if (nav.fields.length >= MAX_ROWS) return
                    nav.append({ label: '', href: '' }, { focusName: `nav.${nav.fields.length}.label` })
                    setListMessage('Menu link added.')
                  }}
                >
                  <FiPlus aria-hidden />
                  Add menu link
                </Button>
              </div>
            </FieldSet>
            <TextField control={control} name="footerText" label="Footer text" multiline description="A short line at the bottom of every page." />
          </FieldGroup>
        </TabsContent>
      </Tabs>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-4">
        {/* aria-disabled, not disabled: a disabled button would drop keyboard focus mid-save. */}
        <Button type="submit" aria-disabled={saving} className={cn(saving && 'opacity-50')}>
          Save settings
        </Button>
        <Link href="/admin" className={buttonVariants({ variant: 'ghost' })}>
          Back to dashboard
        </Link>
        <p role="status" aria-live="polite" className="text-sm">
          {saving ? 'Saving…' : saved && !formState.isDirty ? 'Saved. The site is updated.' : ''}
        </p>
      </div>
      {leaveDialog}
    </form>
  )
}
