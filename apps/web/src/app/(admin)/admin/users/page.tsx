import { EmptyState } from '@/components/admin/EmptyState'
import { PageHeader } from '@/components/admin/PageHeader'
import { requireAdminPage, unwrap } from '@/lib/admin/unwrap'
import { listUsersAction } from '@/server/actions/users'

export const metadata = { title: 'Users' }

export default async function UsersPage() {
  await requireAdminPage()
  const users = unwrap(await listUsersAction())

  return (
    <>
      <PageHeader title="Users" />

      {/* TODO(ui): "Add user" dialog -> createUserAction({ email, name, password, role }).
          Row actions: edit name and role (updateUserAction), reset password
          (resetUserPasswordAction, signs that person out everywhere), delete (deleteUserAction).
          The last admin cannot be demoted or deleted; show the returned message. */}

      {users.length === 0 ? (
        <EmptyState title="No users" />
      ) : (
        <ul className="divide-y rounded-lg border">
          {users.map((user) => (
            <li key={user.id} className="flex items-center justify-between gap-3 p-3">
              <span className="font-medium">{user.name}</span>
              <span className="text-sm text-muted-foreground">
                {user.email} · {user.role}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
