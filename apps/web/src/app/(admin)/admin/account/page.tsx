import { redirect } from 'next/navigation'

import { PageHeader } from '@/components/admin/PageHeader'
import { ConnectedProviders } from '@/components/admin/account/ConnectedProviders'
import { DeleteAccountCard } from '@/components/admin/account/DeleteAccountCard'
import { EmailCard } from '@/components/admin/account/EmailCard'
import { ProfilePicture } from '@/components/admin/account/ProfilePicture'
import { TwoFactorCard } from '@/components/admin/two-factor/TwoFactorCard'
import { errorCode, providerConnectError } from '@/lib/auth-provider-errors'
import { getMyProvidersAction } from '@/server/actions/auth-providers'
import { getEmailChangeStatusAction } from '@/server/actions/email-change'
import { unwrap } from '@/lib/admin/unwrap'
import { getSettings } from '@/lib/queries'
import { getTwoFactorStatusAction } from '@/server/actions/two-factor'
import { MIN_PASSWORD_LENGTH } from '@/server/auth'
import { getSessionUser } from '@/server/session'
import { DELETION_GRACE_DAYS, isLastActiveAdmin } from '@/server/users'

import { AccountForms } from './AccountForms'

export const metadata = { title: 'Account' }

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ connected?: string | string[]; error?: string | string[] }> }) {
  const user = await getSessionUser()
  if (!user) redirect('/admin/login')

  const [status, settings, providers, query, emailStatus, lastAdmin] = await Promise.all([
    getTwoFactorStatusAction().then(unwrap),
    getSettings(),
    getMyProvidersAction().then((result) => (result.ok ? result.data : [])),
    searchParams,
    getEmailChangeStatusAction().then(unwrap),
    isLastActiveAdmin(user.id),
  ])
  // Back from connecting a provider: ?connected=<slug>, or ?error=<code> from Better Auth.
  const failed = errorCode(query.error)
  const connected = providers.find((provider) => provider.slug === query.connected && provider.connected)
  const notice = failed
    ? { text: providerConnectError(failed), isError: true }
    : connected
      ? { text: `${connected.name} is connected. You can now sign in with it.`, isError: false }
      : null
  return (
    <>
      <PageHeader title="Account" description={user.email} />
      <div className="flex max-w-2xl flex-col gap-6">
        <ProfilePicture user={user} />
        <AccountForms user={user} minPasswordLength={MIN_PASSWORD_LENGTH} />
        <EmailCard user={user} status={emailStatus} />
        <TwoFactorCard status={status} siteName={settings.siteName} />
        <ConnectedProviders providers={providers} notice={notice} />
        <DeleteAccountCard user={user} graceDays={DELETION_GRACE_DAYS} lastAdmin={lastAdmin} />
      </div>
    </>
  )
}
