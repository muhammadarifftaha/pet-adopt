import { can } from '@pet-adopt/plugin-sdk'

import { TwoFactorRoles } from '@/components/admin/users/TwoFactorRoles'
import { ViewOnly, ViewOnlyNotice } from '@/components/admin/view-only'
import { requirePermissionPage, unwrap } from '@/lib/admin/unwrap'
import { getTwoFactorRolesAction } from '@/server/actions/two-factor'

export const metadata = { title: 'Two-factor' }

// Authentication > Two-factor: which roles must use two-factor sign-in. Admins change it; audit
// views it. Each person sets up their own on the Account page; an admin turns it off for someone
// who lost their phone on the Users screen.
export default async function TwoFactorSettingsPage() {
  const me = await requirePermissionPage('users:view')
  const roles = unwrap(await getTwoFactorRolesAction())

  return (
    <ViewOnly value={!can(me.role, 'users:edit')}>
      <ViewOnlyNotice role={me.role} what="the sign-in rules" />
      <div className="max-w-2xl">
        <TwoFactorRoles roles={roles} meRole={me.role} meEnabled={me.twoFactorEnabled} />
      </div>
    </ViewOnly>
  )
}
