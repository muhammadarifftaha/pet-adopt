'use client'

import { FieldLabel } from '@puckeditor/core'
import React from 'react'
import useSWR from 'swr'
import type { ActionResult, PluginBlockChoice } from '@pet-adopt/plugin-sdk'

// A plugin block's `choice` option in the page builder's sidebar: a plain <select> filled by the
// plugin's own server action (the editor has no Tailwind, so a native control keeps it simple and
// accessible). Stores the picked entry's value as it was given (a number stays a number), or null.

type Props = {
  id?: string
  label: string
  /** The SWR key: one list per block and option, shared by every instance of that block. */
  cacheKey: string
  load: () => Promise<ActionResult<PluginBlockChoice[]>>
  empty?: string
  value: unknown
  onChange: (value: string | number | null) => void
  readOnly?: boolean
}

async function fetchChoices(load: Props['load']): Promise<PluginBlockChoice[]> {
  const result = await load()
  if (!result || result.ok !== true) throw new Error(result && result.ok === false ? result.error : 'Could not load the choices')
  return Array.isArray(result.data) ? result.data.filter((entry) => entry && typeof entry.label === 'string' && (typeof entry.value === 'string' || typeof entry.value === 'number')) : []
}

export function PluginChoiceField({ id, label, cacheKey, load, empty, value, onChange, readOnly = false }: Props) {
  const { data, error } = useSWR(cacheKey, () => fetchChoices(load))
  const current = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  // A saved value the list no longer has (a deleted record) stays selected, so opening the block
  // never changes it by itself.
  const missing = current !== '' && data !== undefined && !data.some((entry) => String(entry.value) === current)
  return (
    // Puck draws no label for a custom field: FieldLabel adds a real <label> around the select.
    <FieldLabel label={label} el="label" className="pet-picker">
      <select
        id={id}
        value={current}
        // Puck passes readOnly to custom fields when editing is off (view-only roles).
        disabled={readOnly}
        aria-busy={!data && !error}
        onChange={(event) => {
          const picked = data?.find((entry) => String(entry.value) === event.target.value)
          onChange(picked ? picked.value : null)
        }}
      >
        <option value="">{error ? 'Could not load the choices' : !data ? 'Loading…' : data.length ? (empty ?? 'Choose one') : 'Nothing to choose yet'}</option>
        {missing ? <option value={current}>Not found (deleted?)</option> : null}
        {data?.map((entry) => (
          <option key={String(entry.value)} value={String(entry.value)}>
            {entry.label}
            {entry.note ? ` (${entry.note})` : ''}
          </option>
        ))}
      </select>
    </FieldLabel>
  )
}
