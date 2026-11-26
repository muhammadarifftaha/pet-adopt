import { can } from '@pet-adopt/plugin-sdk'

import { ViewOnly, ViewOnlyNotice } from '@/components/admin/view-only'
import { PageHeader } from '@/components/admin/PageHeader'
import { requirePermissionPage, unwrap } from '@/lib/admin/unwrap'
import { getSettingsAction } from '@/server/actions/settings'
import { listPages } from '@/server/pages'
import { isSystemPageSlug } from '@/puck/data'
import type { SettingsTab } from '@/lib/zod-schema/settings'

import { SettingsForm } from './SettingsForm'

export const metadata = { title: 'Site settings' }

const TABS: SettingsTab[] = ['brand', 'contact', 'navigation']

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const user = await requirePermissionPage('settings:view')
  const settings = unwrap(await getSettingsAction())
  const { tab } = await searchParams
  const initialTab = TABS.find((name) => name === tab) ?? 'brand'
  // Pages that can hold the privacy policy: the owners' own, not archived (the server checks too).
  const privacyPages = (await listPages())
    .filter((page) => !isSystemPageSlug(page.slug) && page.state !== 'archived')
    .map((page) => ({ id: page.id, title: page.title, live: page.state === 'published' }))
    .sort((a, b) => a.title.localeCompare(b.title))

  return (
    <>
      <PageHeader title="Site settings" />
      <ViewOnly value={!can(user.role, 'settings:edit')}>
        <ViewOnlyNotice role={user.role} what="the settings" />
        <SettingsForm settings={settings} privacyPages={privacyPages} initialTab={initialTab} />
      </ViewOnly>
    </>
  )
}
