import Link from 'next/link'

import { EmptyState } from '@/components/admin/EmptyState'
import { PageHeader } from '@/components/admin/PageHeader'
import { StatusBadge } from '@/components/admin/StatusBadge'
import { buttonVariants } from '@/components/ui/button'
import { unwrap } from '@/lib/admin/unwrap'
import { listPagesAction } from '@/server/actions/pages'

export const metadata = { title: 'Pages' }

export default async function PagesPage() {
  const pages = unwrap(await listPagesAction())

  return (
    <>
      <PageHeader
        title="Pages"
        actions={
          <Link href="/admin/pages/new" className={buttonVariants()}>
            New page
          </Link>
        }
      />

      {pages.length === 0 ? (
        <EmptyState title="No pages yet">Create a page, then open the page builder to lay it out.</EmptyState>
      ) : (
        // TODO(ui): a table: title, address (/{slug}; "home" is the homepage), StatusBadge,
        // "unpublished changes" marker (page.hasUnpublishedChanges), updated, and row actions:
        // open page builder (/edit/{id}), settings, view live (published only), delete.
        <ul className="divide-y rounded-lg border">
          {pages.map((page) => (
            <li key={page.id} className="flex items-center justify-between gap-3 p-3">
              <Link href={`/admin/pages/${page.id}`} className="font-medium hover:underline">
                {page.title}
              </Link>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                /{page.slug === 'home' ? '' : page.slug}
                <StatusBadge status={page.status} />
                {page.hasUnpublishedChanges ? <span>Unpublished changes</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
