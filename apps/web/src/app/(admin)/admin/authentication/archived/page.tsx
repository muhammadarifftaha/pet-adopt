import { can } from '@pet-adopt/plugin-sdk'

import { ArchivedAccounts } from '@/components/admin/users/ArchivedAccounts'
import { ViewOnly, ViewOnlyNotice } from '@/components/admin/view-only'
import { requirePermissionPage, unwrap } from '@/lib/admin/unwrap'
import { listUsersAction } from '@/server/actions/users'

export const metadata = { title: 'Archived accounts' }

// Authentication > Archived accounts. Admins restore or delete them; audit views the list.
export default async function ArchivedAccountsPage() {
  const me = await requirePermissionPage('users:view')
  const users = unwrap(await listUsersAction()).filter((user) => user.archivedAt)

  return (
    <ViewOnly value={!can(me.role, 'users:edit')}>
      <ViewOnlyNotice role={me.role} what="the archived accounts" />
      <ArchivedAccounts users={users} />
    </ViewOnly>
  )
}
