'use client'

import type { SessionUser } from '@/server/types'

// TODO(ui): two forms.
//  - Name: `updateProfileAction({ name })`.
//  - Password: `changePasswordAction({ currentPassword, newPassword })`; signs out other devices.
//    Minimum length is 12 in production, 8 in development.
export function AccountForms({ user }: { user: SessionUser }) {
  return <p className="text-sm text-muted-foreground">Account forms for {user.name} go here.</p>
}
