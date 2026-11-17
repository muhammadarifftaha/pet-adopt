import { redirect } from 'next/navigation'

import { PageHeader } from '@/components/admin/PageHeader'
import { getSessionUser } from '@/server/session'

import { AccountForms } from './AccountForms'

export const metadata = { title: 'Account' }

export default async function AccountPage() {
  const user = await getSessionUser()
  if (!user) redirect('/admin/login')

  return (
    <>
      <PageHeader title="Account" description={user.email} />
      <AccountForms user={user} />
    </>
  )
}
