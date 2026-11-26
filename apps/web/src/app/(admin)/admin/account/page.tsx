import { redirect } from 'next/navigation'

import { PageHeader } from '@/components/admin/PageHeader'
import { ConnectedProviders } from '@/components/admin/account/ConnectedProviders'
import { TwoFactorCard } from '@/components/admin/two-factor/TwoFactorCard'
import { errorCode, providerConnectError } from '@/lib/auth-provider-errors'
import { getMyProvidersAction } from '@/server/actions/auth-providers'
import { unwrap } from '@/lib/admin/unwrap'
import { getSettings } from '@/lib/queries'
import { getTwoFactorStatusAction } from '@/server/actions/two-factor'
import { getSessionUser } from '@/server/session'

import { AccountForms } from './AccountForms'

export const metadata = { title: 'Account' }

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ connected?: string | string[]; error?: string | string[] }> }) {
  const user = await getSessionUser()
  if (!user) redirect('/admin/login')

  const [status, settings, providers, query] = await Promise.all([
    getTwoFactorStatusAction().then(unwrap),
    getSettings(),
    getMyProvidersAction().then((result) => (result.ok ? result.data : [])),
    searchParams,
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
        <AccountForms user={user} />
        <TwoFactorCard status={status} siteName={settings.siteName} />
        <ConnectedProviders providers={providers} notice={notice} />
      </div>
    </>
  )
}
