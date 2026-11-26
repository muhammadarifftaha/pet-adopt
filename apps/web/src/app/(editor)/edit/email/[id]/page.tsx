import { can } from '@pet-adopt/plugin-sdk'
import type { Data } from '@puckeditor/core'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'

import { isSystemPurpose, PURPOSE_INFO } from '@/lib/email-template'
import { emailContext, getEmailTemplate, getSystemEmail } from '@/server/email-templates'
import { getSessionUser } from '@/server/session'

import { EmailEditor } from './EmailEditor'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Email builder', robots: { index: false, follow: false } }

// The email builder (Email > Templates). Admins and developers edit; audit looks through it
// read-only.
// `id` is a library template's number, or the name of one of the site's own emails
// (/edit/email/password-reset, /edit/email/test), which are edited in place.
export default async function EditEmailTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const system = isSystemPurpose(id) ? id : null
  const templateId = system ? null : Number(id)
  if (!system && (!Number.isSafeInteger(templateId) || (templateId as number) < 1)) notFound()

  const user = await getSessionUser()
  if (!user) redirect(`/admin/login?redirect=${encodeURIComponent(`/edit/email/${id}`)}`)
  if (!can(user.role, 'settings:view')) redirect('/admin')
  const readOnly = !can(user.role, 'settings:edit')

  if (system) {
    const email = await getSystemEmail(system)
    return (
      <EmailEditor
        target={{ kind: 'system', purpose: system }}
        name={`${PURPOSE_INFO[system].label} email`}
        purpose={system}
        purposeLabel={email.customised ? 'System email · Edited' : 'System email · Unedited'}
        initialData={email.data as unknown as Data}
        ctx={await emailContext({})}
        defaultTo={user.email}
        readOnly={readOnly}
      />
    )
  }

  const template = await getEmailTemplate(templateId as number)
  if (!template || isSystemPurpose(template.purpose)) notFound()

  return (
    <EmailEditor
      target={{ kind: 'template', id: template.id }}
      name={template.name}
      purpose={template.purpose}
      purposeLabel={PURPOSE_INFO[template.purpose].label}
      initialData={template.data as unknown as Data}
      ctx={await emailContext({})}
      defaultTo={user.email}
      readOnly={readOnly}
    />
  )
}
