import { can } from '@pet-adopt/plugin-sdk'
import { isEqual } from 'es-toolkit'

import { PageHeader } from '@/components/admin/PageHeader'
import { ViewOnly, ViewOnlyNotice } from '@/components/admin/view-only'
import { parseId, requirePermissionPage, unwrapOrNotFound } from '@/lib/admin/unwrap'
import { getPageAction } from '@/server/actions/pages'

import { PageForm, type PageFormPage } from '../PageForm'

export const metadata = { title: 'Page settings' }

// The page builder's "Page settings" link lands here. "Open page builder" is in the form's button
// row, next to Save.
export default async function PageSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionPage('pages:view')
  const { id } = await params
  const page = unwrapOrNotFound(await getPageAction(parseId(id)))

  // Only what the form shows: the layout JSON itself stays on the server.
  const formPage: PageFormPage = {
    id: page.id,
    title: page.title,
    slug: page.slug,
    status: page.status,
    archived: page.archivedAt !== null,
    publishedAt: page.publishedAt,
    seoDescription: page.seo.description,
    seoImage: page.seo.image
      ? { id: page.seo.image.id, thumbnailUrl: page.seo.image.thumbnailUrl, alt: page.seo.image.alt }
      : null,
    hasLayout: page.puckDraft != null,
    hasUnpublishedChanges: page.puckDraft != null && !isEqual(page.puckDraft, page.puckPublished ?? null),
  }

  return (
    <>
      <PageHeader title={page.title} description="Title, address and how the page looks when shared." />
      <ViewOnly value={!can(user.role, 'pages:edit')}>
        <ViewOnlyNotice role={user.role} what="this page" />
        <PageForm page={formPage} />
      </ViewOnly>
    </>
  )
}
