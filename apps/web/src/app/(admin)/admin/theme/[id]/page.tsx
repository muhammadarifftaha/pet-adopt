import { can } from '@pet-adopt/plugin-sdk'

import { ViewOnly, ViewOnlyNotice } from '@/components/admin/view-only'
import { ThemeEditor } from '@/components/admin/theme/ThemeEditor'
import { PageHeader } from '@/components/admin/PageHeader'
import { parseId, requirePermissionPage, unwrap, unwrapOrNotFound } from '@/lib/admin/unwrap'
import { getThemeAction, listThemesAction } from '@/server/actions/themes'

export const metadata = { title: 'Edit theme' }

export default async function EditThemePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionPage('theme:view')
  const { id } = await params
  const theme = unwrapOrNotFound(await getThemeAction(parseId(id)))
  const { activeThemeId } = unwrap(await listThemesAction())
  return (
    <>
      <PageHeader title={theme.name} description="Change anything, and see it in the preview as you go. Nothing changes on the site until you save." />
      <ViewOnly value={!can(user.role, 'theme:edit')}>
        <ViewOnlyNotice role={user.role} what="this theme" />
        <ThemeEditor theme={theme} isActive={activeThemeId === theme.id} />
      </ViewOnly>
    </>
  )
}
