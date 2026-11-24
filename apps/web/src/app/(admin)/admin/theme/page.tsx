import { ThemeLibrary } from '@/components/admin/theme/ThemeLibrary'
import { PageHeader } from '@/components/admin/PageHeader'
import { requireAdminPage, unwrap } from '@/lib/admin/unwrap'
import { listThemesAction } from '@/server/actions/themes'

export const metadata = { title: 'Theme' }

// The look of the whole site: built-in presets and the owner's own themes (admin only).
export default async function ThemePage() {
  await requireAdminPage()
  const { themes, activeThemeId, preset } = unwrap(await listThemesAction())
  return (
    <>
      <PageHeader
        title="Theme"
        description="Choose how the whole site looks. Use a built-in preset as it is, or make your own theme from one and change its colours, fonts and shapes."
      />
      <ThemeLibrary themes={themes} activeThemeId={activeThemeId} preset={preset} />
    </>
  )
}
