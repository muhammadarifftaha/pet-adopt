'use client'

import { FieldLabel } from '@puckeditor/core'
import React from 'react'
import useSWR from 'swr'

import { unwrapResult } from '@/lib/admin/unwrap-client'

import { listPetChoicesAction } from './actions'

// The Pet spotlight's "Pet" field: a plain <select> of the owner's pets (the editor has no Tailwind,
// so a native control keeps it simple and accessible). Stores the pet's id, or null.
export function PetPicker({ id, value, onChange, readOnly = false }: { id?: string; value: number | null; onChange: (value: number | null) => void; readOnly?: boolean }) {
  const { data, error } = useSWR('puck-pet-choices', async () => unwrapResult(await listPetChoicesAction()))
  // A saved pet that is not in the list (deleted, or older than the newest 500) keeps its own
  // option, so the block does not look unset.
  const missing = value != null && data !== undefined && !data.some((pet) => pet.id === value)
  return (
    // Puck draws no label for a custom field: FieldLabel adds a real <label> around the select.
    <FieldLabel label="Pet" el="label" className="pet-picker">
      <select
        id={id}
        value={value ?? ''}
        // Puck passes readOnly to custom fields when editing is off (view-only roles).
        disabled={readOnly}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
        aria-busy={!data && !error}
      >
        <option value="">{data ? 'Choose a pet' : error ? 'Could not load the pets' : 'Loading pets…'}</option>
        {missing ? <option value={value}>Not found (deleted?)</option> : null}
        {data?.map((pet) => (
          <option key={pet.id} value={pet.id}>
            {pet.name}
            {pet.note ? ` (${pet.note})` : ''}
          </option>
        ))}
      </select>
    </FieldLabel>
  )
}
