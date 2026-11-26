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
  confirmToVisitor,
  notifyNewResponse,
  submitResponse,
  toFormId,
  updateForm,
  type FormRecord,
  type FormSummary,
} from './server'
import { checkCaptchaKeys, getCaptchaSettings, saveCaptchaSettings, type CaptchaSettingsView } from './captcha'

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

// --- Spam protection (admins and developers; audit views) ---------------------------------

export async function getCaptchaSettingsAction(): Promise<ActionResult<CaptchaSettingsView>> {
  return host().run(async () => {
    await host().requirePermission(accessPermission('admin', 'view'))
    return getCaptchaSettings()
  })
}

/** `{ provider, siteKey, secret?, clearSecret?, minScore?, enabled? }`; a blank secret keeps the saved one. */
export async function saveCaptchaSettingsAction(input: unknown): Promise<ActionResult<CaptchaSettingsView>> {
  return host().run(async () => {
    await host().requirePermission(accessPermission('admin', 'edit'))
    const before = await getCaptchaSettings()
    const saved = await saveCaptchaSettings(input)
    // Names only (keys are secrets or close to it).
    const fields = [
      before.provider !== saved.provider && 'service',
      before.siteKey !== saved.siteKey && 'site key',
      (input as { secret?: unknown; clearSecret?: unknown })?.secret || (input as { clearSecret?: unknown })?.clearSecret ? 'secret key' : null,
      before.minScore !== saved.minScore && 'minimum score',
      before.enabled !== saved.enabled && 'on or off',
    ].filter((field): field is string => Boolean(field))
    await host().recordActivity({ action: 'form-builder.captcha.update', summary: 'Changed the forms’ spam protection', fields })
    return saved
  })
}

/** "Check these keys": `token` comes from the widget drawn with the saved site key. */
export async function checkCaptchaKeysAction(token: unknown): Promise<ActionResult<CaptchaSettingsView>> {
  return host().run(async () => {
    await host().requirePermission(accessPermission('admin', 'edit'))
    const checked = await checkCaptchaKeys(token, await host().clientAddress())
    await host().recordActivity({ action: 'form-builder.captcha.check', summary: 'Checked the forms’ spam protection keys' })
    return checked
  })
}

// --- Visitors (no account) -----------------------------------------------------------------

/**
 * A visitor sends a form. `answers` is `{ [fieldId]: value }`; `website` is the honeypot (a field
 * people never see, so only bots fill it); `captchaToken` is the spam check's answer when forms
 * are protected (src/captcha.ts). Errors come back per field id. The team notification and
 * the visitor's confirmation (when the form has them) are sent after the answer, so the visitor
 * never waits for email.
 */
export async function submitFormAction(formId: number, answers: unknown, website?: unknown, captchaToken?: unknown): Promise<ActionResult<{ message: string }>> {
  return host().run(async () => {
    const client = await host().clientAddress()
    const result = await submitResponse(toFormId(formId), answers, { client, honeypot: website, captchaToken })
    const stored = result.stored
    // After the answer, so the visitor never waits for email.
    if (stored) after(() => Promise.all([notifyNewResponse(stored.form, stored.answers), confirmToVisitor(stored.form, stored.answers, client)]))
    return { message: result.message }
  })
}
