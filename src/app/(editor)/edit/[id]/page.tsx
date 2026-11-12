import type { Data } from '@puckeditor/core'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import React from 'react'

import { getPayloadClient } from '@/lib/payload'
import { getSettings } from '@/lib/queries'
import { EMPTY_DATA, isPuckData } from '@/puck/data'
import { toSiteMeta } from '@/puck/server'

import { PageEditor } from './PageEditor'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Page builder', robots: { index: false, follow: false } }

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const pageId = Number(id)
  if (!Number.isInteger(pageId)) notFound()

  const payload = await getPayloadClient()
  const { user } = await payload.auth({ headers: await headers() })
  if (!user) redirect(`/admin/login?redirect=${encodeURIComponent(`/edit/${pageId}`)}`)

  const page = await payload
    .findByID({ collection: 'pages', id: pageId, draft: true, depth: 0, user, overrideAccess: false })
    .catch(() => null)
  if (!page) notFound()

  const settings = await getSettings()
  const initialData: Data = isPuckData(page.puckData) ? page.puckData : EMPTY_DATA

  return (
    <PageEditor
      pageId={page.id}
      title={page.title}
      slug={page.slug}
      status={page._status === 'published' ? 'published' : 'draft'}
      initialData={initialData}
      site={toSiteMeta(settings)}
    />
  )
}
