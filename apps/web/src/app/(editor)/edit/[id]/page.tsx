import { can } from '@pet-adopt/plugin-sdk'
import type { Data } from '@puckeditor/core'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'

import { getSettings } from '@/lib/queries'
import { forcedModeCss, resolveTheme } from '@/lib/theme'
import { EMPTY_DATA, isPuckData } from '@/puck/data'
import { toSiteMeta } from '@/puck/server'
import { getPageById } from '@/server/pages'
import { getSessionUser } from '@/server/session'

import { PageEditor } from './PageEditor'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Page builder', robots: { index: false, follow: false } }

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const pageId = Number(id)
  if (!Number.isInteger(pageId)) notFound()

  const user = await getSessionUser()
  if (!user) redirect(`/admin/login?redirect=${encodeURIComponent(`/edit/${pageId}`)}`)
  if (!can(user.role, 'pages:view')) redirect('/admin')
  // View-only roles (audit) get the builder read-only: they can look through every block and its
  // settings, and nothing can be dragged, added, changed or saved (the server refuses saves too).
  const readOnly = !can(user.role, 'pages:edit')

  const page = await getPageById(pageId)
  if (!page) notFound()

  const settings = await getSettings()
  // The builder always opens the latest draft; a page that was never edited starts from what is live.
  const initialData: Data = isPuckData(page.puckDraft) ? page.puckDraft : isPuckData(page.puckPublished) ? page.puckPublished : EMPTY_DATA
  // The site's dark colours, scoped to the canvas, for the "Dark preview" toggle. Only when visitors
  // can see dark mode (Settings: light/dark toggle).
  const theme = resolveTheme(settings)
  const darkCss = theme.allowModeToggle ? forcedModeCss(theme, 'dark', '.editor-canvas[data-mode="dark"]') : null

  return (
    <PageEditor
      pageId={page.id}
      // The draft's settings: what the next publish will have.
      title={page.draftDetails?.title ?? page.title}
      slug={page.draftDetails?.slug ?? page.slug}
      status={page.status}
      version={page.updatedAt.getTime()}
      initialData={initialData}
      site={toSiteMeta(settings)}
      darkCss={darkCss}
      readOnly={readOnly}
    />
  )
}
