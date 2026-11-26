import { redirect } from 'next/navigation'

import { PageHeader } from '@/components/admin/PageHeader'
import { TwoFactorCard } from '@/components/admin/two-factor/TwoFactorCard'
import { unwrap } from '@/lib/admin/unwrap'
import { getSettings } from '@/lib/queries'
import { getTwoFactorStatusAction } from '@/server/actions/two-factor'
import { getSessionUser } from '@/server/session'

import { AccountForms } from './AccountForms'

export const metadata = { title: 'Account' }

export default async function AccountPage() {
  const user = await getSessionUser()
  if (!user) redirect('/admin/login')

  const [status, settings] = await Promise.all([getTwoFactorStatusAction().then(unwrap), getSettings()])
  return (
    <>
      <PageHeader title="Account" description={user.email} />
      <div className="flex max-w-2xl flex-col gap-6">
        <AccountForms user={user} />
        <TwoFactorCard status={status} siteName={settings.siteName} />
      </div>
    </>
  )
}
