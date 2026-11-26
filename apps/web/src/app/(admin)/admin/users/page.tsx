import { can } from '@pet-adopt/plugin-sdk'

import { ViewOnly, ViewOnlyNotice } from '@/components/admin/view-only'
import { PageHeader } from '@/components/admin/PageHeader'
import { TwoFactorRoles } from '@/components/admin/users/TwoFactorRoles'
import { UsersTable } from '@/components/admin/users/UsersTable'
import { requirePermissionPage, unwrap } from '@/lib/admin/unwrap'
import { getTwoFactorRolesAction } from '@/server/actions/two-factor'
import { listUsersAction } from '@/server/actions/users'
import { MIN_PASSWORD_LENGTH } from '@/server/auth'

export const metadata = { title: 'Users' }

// Accounts that can sign in to the admin (admins only). The table and its dialogs are client
// components; every rule is enforced by the actions in src/server/actions/users.ts.
export default async function UsersPage() {
  const me = await requirePermissionPage('users:view')
  const [users, twoFactorRoles] = await Promise.all([listUsersAction().then(unwrap), getTwoFactorRolesAction().then(unwrap)])

  return (
    <>
      <PageHeader title="Users" />
      <ViewOnly value={!can(me.role, 'users:edit')}>
        <ViewOnlyNotice role={me.role} what="the users" />
        <div className="flex flex-col gap-8">
          <UsersTable users={users} meId={me.id} minPasswordLength={MIN_PASSWORD_LENGTH} />
          <div className="max-w-2xl">
            <TwoFactorRoles roles={twoFactorRoles} meRole={me.role} meEnabled={me.twoFactorEnabled} />
          </div>
        </div>
      </ViewOnly>
    </>
  )
}
