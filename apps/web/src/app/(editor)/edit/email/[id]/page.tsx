import { can } from '@pet-adopt/plugin-sdk'
import type { Data } from '@puckeditor/core'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'

import { PURPOSE_INFO } from '@/lib/email-template'
import { emailContext, getEmailTemplate } from '@/server/email-templates'
import { getSessionUser } from '@/server/session'

import { EmailEditor } from './EmailEditor'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Email builder', robots: { index: false, follow: false } }

// The email builder for one template (Settings > Templates). Admins and developers edit; audit
// looks through it read-only.
export default async function EditEmailTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const templateId = Number(id)
  if (!Number.isSafeInteger(templateId) || templateId < 1) notFound()

  const user = await getSessionUser()
  if (!user) redirect(`/admin/login?redirect=${encodeURIComponent(`/edit/email/${templateId}`)}`)
  if (!can(user.role, 'settings:view')) redirect('/admin')

  const template = await getEmailTemplate(templateId)
  if (!template) notFound()

  return (
    <EmailEditor
      templateId={template.id}
      name={template.name}
      purpose={template.purpose}
      purposeLabel={PURPOSE_INFO[template.purpose].label}
      initialData={template.data as unknown as Data}
      ctx={await emailContext({})}
      defaultTo={user.email}
      readOnly={!can(user.role, 'settings:edit')}
    />
  )
}
