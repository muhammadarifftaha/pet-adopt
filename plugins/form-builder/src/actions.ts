'use server'

// The form builder's server actions: what its admin screens (and, for `submitFormAction`, the site's
// Form block) call. Each one checks who is calling through `host()`, takes untrusted input, and
// returns an ActionResult. The rules live in ./server.ts.
import { accessPermission, host, type ActionResult } from '@pet-adopt/plugin-sdk'
import { after } from 'next/server'

import {
  createForm,
  deleteForm,
  deleteResponses,
  exportResponsesCsv,
  getForm,
  listForms,
  listResponses,
  markResponsesRead,
  notifyNewResponse,
  submitResponse,
  toFormId,
  updateForm,
  type FormRecord,
  type FormSummary,
} from './server'

// Changes (and downloads of responses) go into the site's activity log with host().recordActivity,
// after they succeed. Reading and marking responses as read are not logged.
const quoted = (name: string | null | undefined) => `“${(name ?? '').trim() || 'untitled'}”`

/** Which of the form's settings differ (names only: the log holds no values). */
function changed(before: FormRecord | null, after: FormRecord): string[] {
  if (!before) return []
  const labels: Record<string, string> = { name: 'name', description: 'description', fields: 'questions', settings: 'settings', isOpen: 'open or closed' }
  return Object.keys(labels).filter((key) => JSON.stringify(before[key as keyof FormRecord]) !== JSON.stringify(after[key as keyof FormRecord])).map((key) => labels[key])
}

// --- Signed-in team (admins and editors) ---------------------------------------------------

export async function listFormsAction(): Promise<ActionResult<FormSummary[]>> {
  return host().run(async () => {
    await host().requirePermission(accessPermission('all', 'view'))
    return listForms()
  })
}

export async function getFormAction(id: number): Promise<ActionResult<FormRecord | null>> {
  return host().run(async () => {
    await host().requirePermission(accessPermission('all', 'view'))
    return getForm(toFormId(id))
  })
}

/** `{ name, description?, fields?, settings?, isOpen? }` */
export async function createFormAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  return host().run(async () => {
    await host().requirePermission(accessPermission('all', 'edit'))
    const created = await createForm(input)
    const form = await getForm(created.id)
    await host().recordActivity({ action: 'form-builder.form.create', summary: `Created the form ${quoted(form?.name)}`, subject: { id: created.id, label: form?.name } })
    return created
  })
}

/** Any of `{ name, description, fields, settings, isOpen }`; `fields` and `settings` replace what is stored. */
export async function updateFormAction(id: number, input: unknown): Promise<ActionResult<FormRecord>> {
  return host().run(async () => {
    await host().requirePermission(accessPermission('all', 'edit'))
    const formId = toFormId(id)
    const before = await getForm(formId)
    const after = await updateForm(formId, input)
    await host().recordActivity({
      action: 'form-builder.form.update',
      summary: `Updated the form ${quoted(after.name)}`,
      subject: { id: formId, label: after.name },
      fields: changed(before, after),
    })
    return after
  })
}

/** Deletes the form and all of its responses. */
export async function deleteFormAction(id: number): Promise<ActionResult> {
  return host().run(async () => {
    await host().requirePermission(accessPermission('all', 'edit'))
    const formId = toFormId(id)
    const before = await getForm(formId)
    await deleteForm(formId)
    await host().recordActivity({ action: 'form-builder.form.delete', summary: `Deleted the form ${quoted(before?.name)} and its responses`, subject: { id: formId, label: before?.name } })
  })
}

export async function listResponsesAction(formId: number, opts: { page?: number; limit?: number } = {}): Promise<ActionResult<Awaited<ReturnType<typeof listResponses>>>> {
  return host().run(async () => {
    await host().requirePermission(accessPermission('personalData', 'view'))
    return listResponses(toFormId(formId), opts)
  })
}

/** Marks these responses as read; with no ids, all of the form's. */
export async function markResponsesReadAction(formId: number, ids?: number[]): Promise<ActionResult<number>> {
  return host().run(async () => {
    await host().requirePermission(accessPermission('personalData', 'edit'))
    return markResponsesRead(toFormId(formId), ids)
  })
}

export async function deleteResponsesAction(formId: number, ids: number[]): Promise<ActionResult<number>> {
  return host().run(async () => {
    await host().requirePermission(accessPermission('personalData', 'edit'))
    const id = toFormId(formId)
    const removed = await deleteResponses(id, ids)
    if (removed > 0) {
      const form = await getForm(id)
      await host().recordActivity({
        action: 'form-builder.responses.delete',
        summary: `Deleted ${removed} ${removed === 1 ? 'response' : 'responses'} to the form ${quoted(form?.name)}`,
        subject: { id, label: form?.name },
      })
    }
    return removed
  })
}

/** `{ filename, csv }`: the screen turns it into a download. */
export async function exportResponsesCsvAction(formId: number): Promise<ActionResult<{ filename: string; csv: string }>> {
  return host().run(async () => {
    await host().requirePermission('personalData:export')
    const id = toFormId(formId)
    const file = await exportResponsesCsv(id)
    const form = await getForm(id)
    await host().recordActivity({ action: 'form-builder.responses.export', summary: `Downloaded the responses to the form ${quoted(form?.name)} (CSV)`, subject: { id, label: form?.name } })
    return file
  })
}

// --- Visitors (no account) -----------------------------------------------------------------

/**
 * A visitor sends a form. `answers` is `{ [fieldId]: value }`; `website` is the honeypot (a field
 * people never see, so only bots fill it). Errors come back per field id. The notification email,
 * when the form has one, is sent after the answer, so the visitor never waits for it.
 */
export async function submitFormAction(formId: number, answers: unknown, website?: unknown): Promise<ActionResult<{ message: string }>> {
  return host().run(async () => {
    const result = await submitResponse(toFormId(formId), answers, { client: await host().clientAddress(), honeypot: website })
    const stored = result.stored
    if (stored) after(() => notifyNewResponse(stored.form, stored.answers))
    return { message: result.message }
  })
}
