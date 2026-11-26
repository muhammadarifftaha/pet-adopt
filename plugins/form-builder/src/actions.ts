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
    return createForm(input)
  })
}

/** Any of `{ name, description, fields, settings, isOpen }`; `fields` and `settings` replace what is stored. */
export async function updateFormAction(id: number, input: unknown): Promise<ActionResult<FormRecord>> {
  return host().run(async () => {
    await host().requirePermission(accessPermission('all', 'edit'))
    return updateForm(toFormId(id), input)
  })
}

/** Deletes the form and all of its responses. */
export async function deleteFormAction(id: number): Promise<ActionResult> {
  return host().run(async () => {
    await host().requirePermission(accessPermission('all', 'edit'))
    await deleteForm(toFormId(id))
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
    return deleteResponses(toFormId(formId), ids)
  })
}

/** `{ filename, csv }`: the screen turns it into a download. */
export async function exportResponsesCsvAction(formId: number): Promise<ActionResult<{ filename: string; csv: string }>> {
  return host().run(async () => {
    await host().requirePermission('personalData:export')
    return exportResponsesCsv(toFormId(formId))
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
