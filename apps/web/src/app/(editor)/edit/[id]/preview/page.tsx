import type { Data } from '@puckeditor/core'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'

import { BuilderContent } from '@/components/site/BuilderContent'
import { getSettings } from '@/lib/queries'
import { forcedModeCss, resolveTheme } from '@/lib/theme'
import { isPuckData } from '@/puck/data'
import { getPageById, getPageVersionData } from '@/server/pages'
import { getSessionUser } from '@/server/session'

// A signed-in preview of a page's layout, in the site's own styles (the editor layout loads them):
//   /edit/3/preview             the latest draft (or what is live, if it was never edited)
//   /edit/3/preview?version=7   saved version 7
//   ...&mode=dark               in the theme's dark colours (the editor layout is light only)
// The admin pages table shows it in a small iframe. Never cached or indexed.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Preview', robots: { index: false, follow: false } }

type Args = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ version?: string | string[]; mode?: string | string[] }>
}

export default async function PreviewPage({ params, searchParams }: Args) {
  const [{ id }, { version, mode }] = await Promise.all([params, searchParams])
  const pageId = Number(id)
  if (!Number.isSafeInteger(pageId) || pageId < 1) notFound()

  const user = await getSessionUser()
  if (!user) redirect(`/admin/login?redirect=${encodeURIComponent(`/edit/${pageId}/preview`)}`)

  const page = await getPageById(pageId)
  if (!page) notFound()

  let data: unknown
  if (version !== undefined) {
    const number = typeof version === 'string' && /^\d{1,9}$/.test(version) ? Number(version) : NaN
    if (!Number.isSafeInteger(number)) notFound()
    data = await getPageVersionData(pageId, number)
  } else {
    data = isPuckData(page.puckDraft) ? page.puckDraft : page.puckPublished
  }

  // A fixed constant from validated theme values (see themeCss), so it is safe to inline.
  const darkStyle =
    mode === 'dark' ? <style dangerouslySetInnerHTML={{ __html: forcedModeCss(resolveTheme(await getSettings()), 'dark') }} /> : null

  if (!isPuckData(data)) {
    return (
      <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
        {darkStyle}
        <p>This page has no layout yet. Open the page builder to add blocks.</p>
      </main>
    )
  }
  return (
    <main>
      {darkStyle}
      <BuilderContent data={data as Data} title={page.title} />
    </main>
  )
}
