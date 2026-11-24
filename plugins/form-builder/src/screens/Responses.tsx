import { notFound } from 'next/navigation'

import { getForm, listResponses, toFormId } from '../server'
import { ResponsesView } from './ResponsesView'

// /admin/plugins/form-builder/forms/:id/responses?page=N
export async function Responses({ id, page }: { id: string; page?: string | string[] }) {
  let formId: number
  try {
    formId = toFormId(id)
  } catch {
    notFound()
  }
  const form = await getForm(formId)
  if (!form) notFound()
  const list = await listResponses(form.id, { page: Array.isArray(page) ? page[0] : page, limit: 20 })
  return <ResponsesView form={{ id: form.id, name: form.name }} list={list} />
}
