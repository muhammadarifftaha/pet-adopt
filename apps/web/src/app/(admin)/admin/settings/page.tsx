import { can } from '@pet-adopt/plugin-sdk'

import { ViewOnly, ViewOnlyNotice } from '@/components/admin/view-only'
import { PageHeader } from '@/components/admin/PageHeader'
import { SettingsNav } from '@/components/admin/settings/SettingsNav'
import { requirePermissionPage, unwrap } from '@/lib/admin/unwrap'
import { getSettingsAction } from '@/server/actions/settings'

import { SettingsForm } from './SettingsForm'

export const metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const user = await requirePermissionPage('settings:view')
  const settings = unwrap(await getSettingsAction())

  return (
    <>
      <PageHeader title="Site settings" />
      <SettingsNav current="/admin/settings" />
      <ViewOnly value={!can(user.role, 'settings:edit')}>
        <ViewOnlyNotice role={user.role} what="the settings" />
        <SettingsForm settings={settings} />
      </ViewOnly>
    </>
  )
}
