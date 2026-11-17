'use client'

import { Puck, type Data } from '@puckeditor/core'
import React, { useState, useTransition } from 'react'

import { config } from '@/puck/config'
import type { PuckSiteMetadata } from '@/puck/types'

import { fetchPetsAction, publishAction, saveDraftAction } from './actions'

type Props = {
  pageId: number
  title: string
  slug: string
  status: 'draft' | 'published'
  /** The page's `updatedAt` in ms when it was opened. Sent with every save so a stale tab cannot overwrite newer work. */
  version: number
  initialData: Data
  site: PuckSiteMetadata['site']
}

function HeaderActions({
  pageId,
  slug,
  status,
  data,
  version,
  onVersion,
}: {
  pageId: number
  slug: string
  status: string
  data: Data
  version: number
  onVersion: (version: number) => void
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const run = (action: typeof saveDraftAction) =>
    startTransition(async () => {
      const result = await action(pageId, data, version)
      // Every successful save returns the new version; the next one must be based on it.
      if (result.ok) onVersion(result.version)
      setMessage({ ok: result.ok, text: result.message })
    })

  const livePath = slug === 'home' ? '/' : `/${slug}`

  return (
    <div className="editor-actions">
      {message && <span className={message.ok ? 'editor-msg' : 'editor-msg editor-msg-error'}>{message.text}</span>}
      <a href={`/admin/pages/${pageId}`}>Page settings</a>
      {status === 'published' && (
        <a href={livePath} target="_blank" rel="noreferrer">
          View live
        </a>
      )}
      <button type="button" disabled={pending} onClick={() => run(saveDraftAction)}>
        Save draft
      </button>
      <button type="button" className="editor-primary" disabled={pending} onClick={() => run(publishAction)}>
        {pending ? 'Working…' : 'Publish'}
      </button>
    </div>
  )
}

export function PageEditor({ pageId, title, slug, status, version: initialVersion, initialData, site }: Props) {
  const [version, setVersion] = useState(initialVersion)
  // Blocks read site settings and fetch live pets through Puck's metadata.
  const metadata: PuckSiteMetadata = { site, fetchPets: fetchPetsAction }

  return (
    <Puck
      config={config}
      data={initialData}
      metadata={metadata}
      headerTitle={title}
      headerPath={slug === 'home' ? '/' : `/${slug}`}
      // The preview renders in the page itself so it picks up the site's real styles.
      iframe={{ enabled: false }}
      renderHeaderActions={({ state }) => (
        <HeaderActions pageId={pageId} slug={slug} status={status} data={state.data} version={version} onVersion={setVersion} />
      )}
    />
  )
}
