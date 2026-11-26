import { can } from '@pet-adopt/plugin-sdk'

import { EmailTemplates } from '@/components/admin/settings/EmailTemplates'
import { SettingsNav } from '@/components/admin/settings/SettingsNav'
import { ViewOnly, ViewOnlyNotice } from '@/components/admin/view-only'
import { PageHeader } from '@/components/admin/PageHeader'
import { requirePermissionPage, unwrap } from '@/lib/admin/unwrap'
import { listEmailTemplatesAction } from '@/server/actions/email-templates'

export const metadata = { title: 'Email templates' }

// Settings > Email templates (src/server/email-templates.ts). Admins and developers make and change
// templates; audit can look at them.
export default async function EmailTemplatesPage() {
  const user = await requirePermissionPage('settings:view')
  const templates = unwrap(await listEmailTemplatesAction())

  return (
    <>
      <PageHeader title="Site settings" />
      <SettingsNav current="/admin/settings/templates" />
      <ViewOnly value={!can(user.role, 'settings:edit')}>
        <ViewOnlyNotice role={user.role} what="the email templates" />
        <EmailTemplates templates={templates} />
      </ViewOnly>
    </>
  )
}
