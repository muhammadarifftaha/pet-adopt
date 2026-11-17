'use client'

import type { Page } from '@/server/types'

// TODO(ui): the page settings form, for create (page = null) and edit.
//
//  - Fields: title (required), slug (required; "home" is the homepage; reserved words come back as
//    a field error), seoDescription (200), seoImageId. See ADMIN_UI.md section 4.
//  - Save: `savePageDetailsAction(page?.id ?? null, input)` from '@/server/actions/pages'. After
//    creating, offer "Open page builder" (/edit/{id}): a page with no layout cannot be published.
//  - Buttons on an existing page: Publish `publishPageAction(id)`, Unpublish `unpublishPageAction(id)`,
//    Delete `deletePageAction(id)` (with a confirm dialog).
export function PageForm({ page }: { page: Page | null }) {
  return (
    <p className="text-sm text-muted-foreground">
      {page ? `Settings form for "${page.title}" goes here.` : 'The new page form goes here.'}
    </p>
  )
}
