import { can } from '@pet-adopt/plugin-sdk'

import { SendTestEmail } from '@/components/admin/plugins/SendTestEmail'
import { EmailSettingsForm } from '@/components/admin/settings/EmailSettingsForm'
import { ViewOnly, ViewOnlyNotice } from '@/components/admin/view-only'
import { requirePermissionPage, unwrap } from '@/lib/admin/unwrap'
import { getEmailSettingsAction } from '@/server/actions/email'

export const metadata = { title: 'Email' }

// Email > Sending: the built-in SMTP sender (src/server/email.ts). Admins and developers change it
// (`settings:edit`); audit sees it, never the password.
export default async function EmailSettingsPage() {
  const user = await requirePermissionPage('settings:view')
  const view = unwrap(await getEmailSettingsAction())
  const canEdit = can(user.role, 'settings:edit')

  return (
    <>
      <ViewOnly value={!canEdit}>
        <ViewOnlyNotice role={user.role} what="the email settings" />
        <EmailSettingsForm initial={view} />
      </ViewOnly>
      {canEdit ? (
        <section className="mt-8 max-w-3xl rounded-lg border p-4">
          {/* Uses whatever sends the site's email: this SMTP server, or an email plugin. */}
          <SendTestEmail defaultTo={user.email} disabled={!view.ready && !view.plugin?.ready} />
        </section>
      ) : null}
    </>
  )
}
