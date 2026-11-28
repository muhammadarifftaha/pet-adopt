import { can } from '@pet-adopt/plugin-sdk'
import type { Data } from '@puckeditor/core'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'

import { getPetPagePreview, getSettings, type PetPageData } from '@/lib/queries'
import { forcedModeCss, resolveTheme } from '@/lib/theme'
import { listPetChoicesAction, type PetChoice } from '@/puck/actions'
import { EMPTY_DATA, isPuckData, PET_PAGE_SLUG } from '@/puck/data'
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
  const page = await getPageById(pageId)
  if (!page) notFound()

  // View-only roles (audit) get the builder read-only: they can look through every block and its
  // settings, and nothing can be dragged, added, changed or saved (the server refuses saves too).
  // An archived page is read-only for everyone (the server refuses its saves), until it is restored.
  const archived = page.archivedAt != null
  const readOnly = archived ? 'archived' : can(user.role, 'pages:edit') ? false : 'role'

  const settings = await getSettings()
  // The builder always opens the latest draft; a page that was never edited starts from what is live.
  const initialData: Data = isPuckData(page.puckDraft) ? page.puckDraft : isPuckData(page.puckPublished) ? page.puckPublished : EMPTY_DATA
  // The site's dark colours, scoped to the canvas, for the "Dark preview" toggle. Only when visitors
  // can see dark mode (Settings: light/dark toggle).
  const theme = resolveTheme(settings)
  const darkCss = theme.allowModeToggle ? forcedModeCss(theme, 'dark', '.editor-canvas[data-mode="dark"]') : null

  // The Pet page template: its own blocks, previewed with a pet (the newest visible one to start).
  let petPreview: { choices: PetChoice[]; pet: PetPageData | null } | null = null
  if (page.slug === PET_PAGE_SLUG) {
    const choices = await listPetChoicesAction()
    const first = choices.find((choice) => !choice.note) ?? choices[0]
    petPreview = { choices, pet: first ? await getPetPagePreview(first.id) : null }
  }

  return (
    <PageEditor
      pageId={page.id}
      // The draft's settings: what the next publish will have.
      title={page.draftDetails?.title ?? page.title}
      slug={page.draftDetails?.slug ?? page.slug}
      // The address visitors reach today ("View live"): a pending address change is not live yet.
      liveSlug={page.slug}
      status={page.status}
      version={page.updatedAt.getTime()}
      initialData={initialData}
      // What is live, and whether page settings wait for a publish: so Publish knows when there is nothing to publish.
      publishedData={page.status === 'published' && isPuckData(page.puckPublished) ? page.puckPublished : null}
      detailsPending={page.draftDetails != null}
      site={toSiteMeta(settings)}
      darkCss={darkCss}
      readOnly={readOnly}
      petPreview={petPreview}
    />
  )
}
