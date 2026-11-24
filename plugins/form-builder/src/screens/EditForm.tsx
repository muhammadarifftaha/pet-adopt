import { notFound } from 'next/navigation'

import { getForm, listResponses, toFormId } from '../server'
import { FormEditor } from './FormEditor'

// /admin/plugins/form-builder/forms/:id
export async function EditForm({ id }: { id: string }) {
  let formId: number
  try {
    formId = toFormId(id)
  } catch {
    notFound()
  }
  const form = await getForm(formId)
  if (!form) notFound()
  const { total } = await listResponses(form.id, { limit: 1 })
  return (
    // No `key` from updatedAt: a save refreshes this screen, and remounting the editor would drop its
    // "Saved." message. The editor takes the saved values from the save's own result instead.
    <FormEditor
      form={{ id: form.id, name: form.name, description: form.description, fields: form.fields, settings: form.settings, isOpen: form.isOpen, responses: total }}
    />
  )
}
