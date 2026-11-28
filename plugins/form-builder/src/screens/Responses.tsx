import { accessPermission, can, type PluginUser, host } from '@pet-adopt/plugin-sdk'
import { notFound } from 'next/navigation'

import { getForm, listResponses, toFormId } from '../server'
import { ResponsesView } from './ResponsesView'

// /admin/plugins/form-builder/forms/:id/responses?page=N
export async function Responses({ id, page, user }: { id: string; page?: string | string[]; user: PluginUser }) {
  let formId: number
  try {
    formId = toFormId(id)
  } catch {
    notFound()
  }
  const form = await getForm(formId)
  if (!form) notFound()
  const list = await listResponses(form.id, { page: Array.isArray(page) ? page[0] : page, limit: 20 })
  return (
    // Keyed by page: the selection belongs to one page, and Newer/Older keep a client component's state.
    <ResponsesView
      key={list.page}
      form={{ id: form.id, name: form.name }}
      list={list}
      canEdit={can(user.role, accessPermission('personalData', 'edit'))}
      canExport={can(user.role, 'personalData:export')}
      timeZone={await host().timeZone()}
    />
  )
}
