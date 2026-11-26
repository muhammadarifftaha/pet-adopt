import { accessPermission, can, type PluginUser } from '@pet-adopt/plugin-sdk'
import { notFound } from 'next/navigation'

import { getForm, listResponses, toFormId } from '../server'
import { FormEditor } from './FormEditor'

// /admin/plugins/form-builder/forms/:id
export async function EditForm({ id, user }: { id: string; user: PluginUser }) {
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
      readOnly={!can(user.role, accessPermission('all', 'edit'))}
      canSeeResponses={can(user.role, accessPermission('personalData', 'view'))}
      form={{ id: form.id, name: form.name, description: form.description, fields: form.fields, settings: form.settings, isOpen: form.isOpen, responses: total }}
    />
  )
}
