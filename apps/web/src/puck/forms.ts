// The Form block's data (the form builder plugin's forms), for the public site and the editor.
// Server-only. A form never breaks a page: a missing form, a form builder whose tables are not set
// up yet, or a database error all give null, and the block then shows nothing on the live site.
import { getPublicForm, type PublicForm } from '@pet-adopt/plugin-form-builder/server'

import { logError } from '@/server/result'
// Registers how plugin storage is opened (a no-op if the server start already did).
import '@/plugins/storage'
import { PluginNotReadyError } from '@/plugins/storage'

export type { PublicForm }

export async function fetchPublicForm(id: unknown): Promise<PublicForm | null> {
  const formId = Number(id)
  if (!Number.isSafeInteger(formId) || formId < 1) return null
  try {
    return await getPublicForm(formId)
  } catch (error) {
    if (!(error instanceof PluginNotReadyError) && process.env.NEXT_PHASE !== 'phase-production-build') logError(error, 'Form block')
    return null
  }
}
