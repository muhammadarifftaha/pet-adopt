'use client'

import { FieldLabel } from '@puckeditor/core'
import React from 'react'
import useSWR from 'swr'

import { listPetChoicesAction } from './actions'

// The Pet spotlight's "Pet" field: a plain <select> of the owner's pets (the editor has no Tailwind,
// so a native control keeps it simple and accessible). Stores the pet's id, or null.
export function PetPicker({ id, value, onChange, readOnly = false }: { id?: string; value: number | null; onChange: (value: number | null) => void; readOnly?: boolean }) {
  const { data, error } = useSWR('puck-pet-choices', () => listPetChoicesAction())
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
