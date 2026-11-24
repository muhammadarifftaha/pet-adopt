import Link from 'next/link'

import { PagesTable } from '@/components/admin/pages/PagesTable'
import { EmptyState } from '@/components/admin/EmptyState'
import { PageHeader } from '@/components/admin/PageHeader'
import { buttonVariants } from '@/components/ui/button'
import { unwrap } from '@/lib/admin/unwrap'
import { getSettings } from '@/lib/queries'
import { resolveTheme } from '@/lib/theme'
import { listPagesAction } from '@/server/actions/pages'

export const metadata = { title: 'Pages' }

export default async function PagesPage() {
  const [pages, settings] = await Promise.all([listPagesAction().then(unwrap), getSettings()])
  // Dark previews only when visitors can see the dark theme (Settings: light/dark toggle).
  const darkMode = resolveTheme(settings).allowModeToggle

  return (
    <>
      <PageHeader
        title="Pages"
        description="Open a row to preview the page and its saved versions. Archive a page to take it off the site; an archived page can be restored or deleted."
        actions={
          <Link href="/admin/pages/new" className={buttonVariants()}>
            New page
          </Link>
        }
      />

      {pages.length === 0 ? (
        <EmptyState title="No pages yet">Create a page, then open the page builder to lay it out.</EmptyState>
      ) : (
        <PagesTable pages={pages} darkMode={darkMode} />
      )}
    </>
  )
}
