'use client'

import React from 'react'

import { Button } from '@pet-adopt/ui/components/button'
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from '@pet-adopt/ui/components/combobox'
import { Input } from '@pet-adopt/ui/components/input'
import { countryOf, DEFAULT_REGION, formatNational, joinPhone, listCountries, splitPhone, type Country } from '@/lib/phone'

// A phone number as a country picker (searchable by name, ISO code or "+60") plus the number.
// The value is one string in E.164 ("+60123456789"), or as typed while it is not a valid number,
// so validation (libphonenumber-js, src/lib/phone.ts) can say what is wrong. The field's <label>
// points at the number box; the picker names itself and the country it holds.

const countries = listCountries()

/** Search: the name anywhere, the ISO code exactly, or the calling code from its start ("+6", "60"). */
function matches(country: Country, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const digits = q.replace(/^\+/, '')
  if (/^\d+$/.test(digits)) return String(country.callingCode).startsWith(digits)
  return country.name.toLowerCase().includes(q) || country.region.toLowerCase() === q
}

export function PhoneInput({
  id,
  value,
  onChange,
  onBlur,
  inputRef,
  invalid,
  describedBy,
  required,
  autoComplete = 'tel',
}: {
  id: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  /** A callback ref, such as React Hook Form's `field.ref` (so a failed save can focus the number). */
  inputRef?: (node: HTMLInputElement | null) => void
  invalid?: boolean
  describedBy?: string
  required?: boolean
  autoComplete?: string
}) {
  const [state, setState] = React.useState(() => splitPhone(value))
  // The last value this input sent. Anything else arriving (a form reset, a reload) is re-split.
  const [sent, setSent] = React.useState(value)
  if (value !== sent) {
    setSent(value)
    setState(splitPhone(value, state.region))
  }
  const numberRef = React.useRef<HTMLInputElement | null>(null)
  const country = countryOf(state.region) ?? countryOf(DEFAULT_REGION)!

  const send = (next: { region: string; national: string }) => {
    setState(next)
    const joined = joinPhone(next.region, next.national)
    setSent(joined)
    onChange(joined)
  }

  return (
    <div className="flex gap-2">
      <Combobox
        items={countries}
        value={country}
        onValueChange={(picked: Country | null) => {
          if (!picked) return
          send({ region: picked.region, national: state.national })
          requestAnimationFrame(() => numberRef.current?.focus())
        }}
        itemToStringLabel={(item: Country) => `${item.name} +${item.callingCode}`}
        itemToStringValue={(item: Country) => item.region}
        isItemEqualToValue={(a: Country, b: Country) => a.region === b.region}
        filter={(item: Country, query: string) => matches(item, query)}
      >
        <ComboboxTrigger
          render={<Button type="button" variant="outline" className="shrink-0 gap-1.5 px-2.5 font-normal tabular-nums" />}
          aria-label={`Country code: ${country.name}, +${country.callingCode}`}
          aria-invalid={invalid || undefined}
        >
          <span aria-hidden="true">{country.flag}</span>+{country.callingCode}
        </ComboboxTrigger>
        <ComboboxContent className="w-72 min-w-0">
          <ComboboxInput showTrigger={false} placeholder="Search country or code" aria-label="Search countries or codes" />
          <ComboboxEmpty>No country matches.</ComboboxEmpty>
          <ComboboxList>
            {(item: Country) => (
              <ComboboxItem key={item.region} value={item}>
                <span aria-hidden="true">{item.flag}</span>
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="text-muted-foreground tabular-nums">+{item.callingCode}</span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <Input
        id={id}
        ref={(node) => {
          numberRef.current = node
          inputRef?.(node)
        }}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        value={state.national}
        placeholder={country.region === 'MY' ? '12 345 6789' : undefined}
        onChange={(event) => send({ region: state.region, national: event.target.value })}
        onBlur={() => {
          // A number pasted with its own "+code" moves the picker to that country; a valid number
          // is tidied into the usual grouping ("123456789" -> "12 345 6789").
          const typed = state.national.trim()
          const next = typed.startsWith('+') ? splitPhone(typed, state.region) : { region: state.region, national: formatNational(state.region, typed) }
          if (next.region !== state.region || next.national !== state.national) send(next)
          onBlur?.()
        }}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        aria-describedby={describedBy}
        className="min-w-0 flex-1"
      />
    </div>
  )
}
