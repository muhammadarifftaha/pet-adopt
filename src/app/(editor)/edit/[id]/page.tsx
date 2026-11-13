import type { Data } from '@puckeditor/core'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'

import { getSettings } from '@/lib/queries'
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

  const page = await getPageById(pageId)
  if (!page) notFound()

  const settings = await getSettings()
  // The builder always opens the latest draft; a page that was never edited starts from what is live.
  const initialData: Data = isPuckData(page.puckDraft) ? page.puckDraft : isPuckData(page.puckPublished) ? page.puckPublished : EMPTY_DATA

  return (
    <PageEditor
      pageId={page.id}
      title={page.title}
      slug={page.slug}
      status={page.status}
      initialData={initialData}
      site={toSiteMeta(settings)}
    />
  )
}
