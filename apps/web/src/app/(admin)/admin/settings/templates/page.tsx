import { can, foldText } from '@pet-adopt/plugin-sdk'

import { EmailTemplates } from '@/components/admin/settings/EmailTemplates'
import { SettingsNav } from '@/components/admin/settings/SettingsNav'
import { ViewOnly, ViewOnlyNotice } from '@/components/admin/view-only'
import { PageHeader } from '@/components/admin/PageHeader'
import { SYSTEM_PURPOSES } from '@/lib/email-template'
import { requirePermissionPage, unwrap } from '@/lib/admin/unwrap'
import { listEmailTemplatesAction } from '@/server/actions/email-templates'
import { getEmailTemplateUsage } from '@/plugins/registry'
import { getSystemEmail } from '@/server/email-templates'

export const metadata = { title: 'Email templates' }

// Settings > Email templates (src/server/email-templates.ts). Admins and developers make and change
// templates; audit can look at them.
export default async function EmailTemplatesPage() {
  const user = await requirePermissionPage('settings:view')
  const [library, usage] = await Promise.all([listEmailTemplatesAction().then(unwrap), getEmailTemplateUsage()])
  const templates = library
    // Forms that picked nothing use a plugin's default template: listed under it too.
    .map((template) => ({ ...template, usedBy: [...(usage.get(template.id) ?? []), ...(template.seedKey ? (usage.get(template.seedKey) ?? []) : [])] }))
    .sort((a, b) => foldText(a.name).localeCompare(foldText(b.name)))
  const system = await Promise.all(SYSTEM_PURPOSES.map(async (purpose) => {
    const email = await getSystemEmail(purpose)
    return { purpose, customised: email.customised, updatedAt: email.updatedAt }
  }))

  return (
    <>
      <PageHeader title="Site settings" />
      <SettingsNav current="/admin/settings/templates" />
      <ViewOnly value={!can(user.role, 'settings:edit')}>
        <ViewOnlyNotice role={user.role} what="the email templates" />
        <EmailTemplates templates={templates} system={system} />
      </ViewOnly>
    </>
  )
}
