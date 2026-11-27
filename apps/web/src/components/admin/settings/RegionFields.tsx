'use client'

import { foldText, isTimeZone } from '@pet-adopt/plugin-sdk'
import React from 'react'
import { Controller, useWatch, type Control } from 'react-hook-form'
import useSWR from 'swr'

import { Button } from '@pet-adopt/ui/components/button'
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from '@pet-adopt/ui/components/combobox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@pet-adopt/ui/components/field'
import { unwrapResult } from '@/lib/admin/unwrap-client'
import type { PlaceCountry } from '@/lib/places'
import type { SettingsFormValues } from '@/lib/zod-schema/settings'
import { listCountryTimeZonesAction, listPlaceCountriesAction } from '@/server/actions/places'

// Site settings > Region: the country the site is in (new pets start with it, and it chooses the
// cities and states the pet form suggests) and the time zone the admin shows times in. Both are
// picked from searchable lists. Picking a country with a single time zone fills an empty Time zone,
// and a country's own zones are listed first.

const ONCE = { revalidateOnFocus: false, revalidateIfStale: false, revalidateOnReconnect: false } as const

const fieldId = (name: string) => `settings-${name}`
const describedBy = (name: string, hasError: boolean) => [`${fieldId(name)}-description`, hasError ? `${fieldId(name)}-error` : null].filter(Boolean).join(' ')

type Zone = {
  /** The IANA name, or "" for no site time zone. */
  value: string
  label: string
  /** "GMT+8", blank when the runtime cannot say. */
  offset: string
}

const DEVICE_TIME: Zone = { value: '', label: "Each person's own device time", offset: '' }

function offsetOf(timeZone: string, at: Date) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(at)
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

const zoneOf = (value: string, at: Date): Zone => ({ value, label: value.replace(/_/g, ' '), offset: offsetOf(value, at) })

/** Every time zone this browser knows, with today's offset. Built when the list is first opened. */
function allZones(): Zone[] {
  const now = new Date()
  const names = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return [...new Set(['UTC', ...names])].map((name) => zoneOf(name, now))
}

function matchesCountry(country: PlaceCountry, query: string) {
  const term = foldText(query).trim()
  return !term || foldText(country.name).includes(term) || country.code.toLowerCase() === term
}

function matchesZone(zone: Zone, query: string) {
  const term = foldText(query).trim().replace(/_/g, ' ')
  return !term || foldText(zone.label).includes(term) || foldText(zone.offset).includes(term)
}

export function RegionFields({ control, setTimeZone }: { control: Control<SettingsFormValues>; setTimeZone: (value: string) => void }) {
  const [code, timeZone] = useWatch({ control, name: ['country', 'timeZone'] })

  const countries = useSWR(['places', 'countries'], async () => unwrapResult(await listPlaceCountriesAction()), ONCE)
  const countryZones = useSWR(code ? ['places', 'time-zones', code] : null, async () => unwrapResult(await listCountryTimeZonesAction(code)), ONCE)
  const country = countries.data?.find((entry) => entry.code === code) ?? null

  // The full list is only built once the picker is opened (it asks the browser about ~400 zones).
  const [opened, setOpened] = React.useState(false)
  const zones = React.useMemo(() => {
    if (!opened) return [DEVICE_TIME]
    const all = allZones()
    const mine = new Set((countryZones.data ?? []).filter((name) => isTimeZone(name)))
    const known = new Set(all.map((zone) => zone.value))
    const now = new Date()
    // The country's own zones first (even one this browser does not list), then the rest by name.
    const first = [...mine].map((name) => all.find((zone) => zone.value === name) ?? zoneOf(name, now))
    const saved = timeZone && !known.has(timeZone) && !mine.has(timeZone) ? [zoneOf(timeZone, now)] : []
    return [DEVICE_TIME, ...first, ...saved, ...all.filter((zone) => !mine.has(zone.value))]
  }, [opened, countryZones.data, timeZone])

  const chosenZone: Zone = timeZone ? { value: timeZone, label: timeZone.replace(/_/g, ' '), offset: '' } : DEVICE_TIME

  const countryId = fieldId('country')
  const zoneId = fieldId('timeZone')

  return (
    <>
      <Controller
        name="country"
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid || undefined}>
            <FieldLabel htmlFor={countryId}>Country</FieldLabel>
            <FieldDescription id={`${countryId}-description`}>
              Where your pets usually are. A new pet starts with this country, and the pet form suggests its cities and states. A pet somewhere else can
              be given its own country.
            </FieldDescription>
            <Combobox
              items={countries.data ?? []}
              value={country}
              onValueChange={async (picked: PlaceCountry | null) => {
                if (!picked) return
                field.onChange(picked.code)
                // A country with one time zone fills an empty Time zone; a failure just leaves it empty.
                if (timeZone) return
                const result = await listCountryTimeZonesAction(picked.code).catch(() => null)
                const only = result?.ok && result.data.length === 1 ? result.data[0] : null
                if (only && isTimeZone(only)) setTimeZone(only)
              }}
              itemToStringLabel={(item: PlaceCountry) => item.name}
              itemToStringValue={(item: PlaceCountry) => item.code}
              isItemEqualToValue={(a: PlaceCountry, b: PlaceCountry) => a.code === b.code}
              filter={(item: PlaceCountry, query: string) => matchesCountry(item, query)}
            >
              <ComboboxTrigger
                id={countryId}
                ref={field.ref}
                onBlur={field.onBlur}
                render={<Button type="button" variant="outline" className="w-full justify-between gap-2 px-2.5 font-normal" />}
                aria-invalid={fieldState.invalid || undefined}
                aria-describedby={describedBy('country', Boolean(fieldState.error))}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {country ? <span aria-hidden="true">{country.flag}</span> : null}
                  <span className="truncate">{country ? country.name : countries.error ? 'Countries could not be loaded' : code || 'Pick a country'}</span>
                </span>
              </ComboboxTrigger>
              <ComboboxContent>
                <ComboboxInput showTrigger={false} placeholder="Search countries" aria-label="Search countries" />
                <ComboboxEmpty>{countries.isLoading ? 'Loading countries…' : 'No country matches.'}</ComboboxEmpty>
                <ComboboxList>
                  {(item: PlaceCountry) => (
                    <ComboboxItem key={item.code} value={item}>
                      <span aria-hidden="true">{item.flag}</span>
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <FieldError id={`${countryId}-error`} errors={[fieldState.error]} />
          </Field>
        )}
      />

      <Controller
        name="timeZone"
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid || undefined}>
            <FieldLabel htmlFor={zoneId}>Time zone</FieldLabel>
            <FieldDescription id={`${zoneId}-description`}>
              The admin shows times (the activity log, page versions, form responses and so on) in this time zone, for everyone. Without one, each
              person sees the time of their own device.
            </FieldDescription>
            <Combobox
              items={zones}
              value={chosenZone}
              onOpenChange={(open) => {
                if (open) setOpened(true)
              }}
              onValueChange={(picked: Zone | null) => {
                if (picked) field.onChange(picked.value)
              }}
              itemToStringLabel={(item: Zone) => item.label}
              itemToStringValue={(item: Zone) => item.value}
              isItemEqualToValue={(a: Zone, b: Zone) => a.value === b.value}
              filter={(item: Zone, query: string) => matchesZone(item, query)}
            >
              <ComboboxTrigger
                id={zoneId}
                ref={field.ref}
                onBlur={field.onBlur}
                render={<Button type="button" variant="outline" className="w-full justify-between gap-2 px-2.5 font-normal" />}
                aria-invalid={fieldState.invalid || undefined}
                aria-describedby={describedBy('timeZone', Boolean(fieldState.error))}
              >
                <span className="truncate">{chosenZone.label}</span>
              </ComboboxTrigger>
              <ComboboxContent>
                <ComboboxInput showTrigger={false} placeholder="Search time zones" aria-label="Search time zones" />
                <ComboboxEmpty>No time zone matches.</ComboboxEmpty>
                <ComboboxList>
                  {(item: Zone) => (
                    <ComboboxItem key={item.value || 'device'} value={item}>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.offset ? <span className="text-muted-foreground tabular-nums">{item.offset}</span> : null}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <FieldError id={`${zoneId}-error`} errors={[fieldState.error]} />
          </Field>
        )}
      />
    </>
  )
}
