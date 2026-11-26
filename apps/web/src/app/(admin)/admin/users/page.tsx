import { can } from '@pet-adopt/plugin-sdk'

import { ViewOnly, ViewOnlyNotice } from '@/components/admin/view-only'
import { PageHeader } from '@/components/admin/PageHeader'
import { UsersTable } from '@/components/admin/users/UsersTable'
import { requirePermissionPage, unwrap } from '@/lib/admin/unwrap'
import { listUsersAction } from '@/server/actions/users'
import { MIN_PASSWORD_LENGTH } from '@/server/auth'

export const metadata = { title: 'Users' }

// Accounts that can sign in to the admin (admins only). The table and its dialogs are client
// components; every rule is enforced by the actions in src/server/actions/users.ts.
export default async function UsersPage() {
  const me = await requirePermissionPage('users:view')
  const users = unwrap(await listUsersAction())

  return (
    <>
      <PageHeader title="Users" />
      <ViewOnly value={!can(me.role, 'users:edit')}>
        <ViewOnlyNotice role={me.role} what="the users" />
        <UsersTable users={users} meId={me.id} minPasswordLength={MIN_PASSWORD_LENGTH} />
      </ViewOnly>
    </>
  )
}
