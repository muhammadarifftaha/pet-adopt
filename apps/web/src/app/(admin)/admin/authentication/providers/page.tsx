import { can } from '@pet-adopt/plugin-sdk'

import { AuthProviders } from '@/components/admin/settings/AuthProviders'
import { ViewOnly, ViewOnlyNotice } from '@/components/admin/view-only'
import { requirePermissionPage, unwrap } from '@/lib/admin/unwrap'
import { listAuthProvidersAction } from '@/server/actions/auth-providers'

export const metadata = { title: 'Sign-in providers' }

// Authentication > Sign-in providers (OAuth 2 / OpenID Connect). Admins change them; audit views.
export default async function SignInProvidersPage() {
  const me = await requirePermissionPage('users:view')
  const providers = unwrap(await listAuthProvidersAction())

  return (
    <ViewOnly value={!can(me.role, 'users:edit')}>
      <ViewOnlyNotice role={me.role} what="the sign-in providers" />
      <AuthProviders providers={providers} />
    </ViewOnly>
  )
}
