'use client'

import { FieldLabel } from '@puckeditor/core'
import React from 'react'
import useSWR from 'swr'

import { listFormChoicesAction } from './actions'

// The Form block's "Form" field: a plain <select> of the form builder's forms (the editor has no
// Tailwind, so a native control keeps it simple and accessible). Stores the form's id, or null.
export function FormPicker({ id, value, onChange }: { id?: string; value: number | null; onChange: (value: number | null) => void }) {
  const { data, error } = useSWR('puck-form-choices', () => listFormChoicesAction())
  return (
    // Puck draws no label for a custom field: FieldLabel adds a real <label> around the select.
    <FieldLabel label="Form" el="label" className="pet-picker">
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
        aria-busy={!data && !error}
      >
        <option value="">
          {data ? (data.length ? 'Choose a form' : 'No forms yet: make one under Plugins, Forms') : error ? 'Could not load the forms' : 'Loading forms…'}
        </option>
        {data?.map((form) => (
          <option key={form.id} value={form.id}>
            {form.name}
            {form.note ? ` (${form.note})` : ''}
          </option>
        ))}
      </select>
    </FieldLabel>
  )
}
