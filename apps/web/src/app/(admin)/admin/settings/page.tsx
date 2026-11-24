import { PageHeader } from '@/components/admin/PageHeader'
import { requireAdminPage, unwrap } from '@/lib/admin/unwrap'
import { getSettingsAction } from '@/server/actions/settings'

import { SettingsForm } from './SettingsForm'

export const metadata = { title: 'Settings' }

export default async function SettingsPage() {
  await requireAdminPage()
  const settings = unwrap(await getSettingsAction())

  return (
    <>
      <PageHeader title="Site settings" />
      <SettingsForm settings={settings} />
    </>
  )
}
