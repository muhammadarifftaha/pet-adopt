'use client'

import { Puck, type Data } from '@puckeditor/core'
import React, { useMemo, useState, useTransition } from 'react'
import { FiMoon, FiSun } from 'react-icons/fi'

import { Switch } from '@/components/ui/switch'
import { config } from '@/puck/config'
import type { PuckSiteMetadata } from '@/puck/types'

import { fetchPetProfilesAction, fetchPetsAction, fetchPetSpotlightAction, publishAction, saveDraftAction } from './actions'

type Props = {
  pageId: number
  title: string
  slug: string
  status: 'draft' | 'published'
  /** The page's `updatedAt` in ms when it was opened. Sent with every save so a stale tab cannot overwrite newer work. */
  version: number
  initialData: Data
  site: PuckSiteMetadata['site']
  /** CSS for the canvas in dark mode (built on the server from checked theme values), or null when the site has no dark mode. */
  darkCss: string | null
}

function HeaderActions({
  pageId,
  slug,
  status,
  data,
  version,
  onVersion,
  dark,
  onDarkChange,
}: {
  pageId: number
  slug: string
  status: string
  data: Data
  version: number
  onVersion: (version: number) => void
  /** null when the site has no dark mode (no toggle shown). */
  dark: boolean | null
  onDarkChange: (dark: boolean) => void
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
      {dark !== null && (
        // shadcn Switch (a button with role="switch"): its name says what it does, the icons only show it.
        <span className="editor-mode-switch">
          <FiSun aria-hidden />
          <Switch checked={dark} onCheckedChange={(checked) => onDarkChange(checked)} aria-label="Dark preview" />
          <FiMoon aria-hidden />
        </span>
      )}
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

export function PageEditor({ pageId, title, slug, status, version: initialVersion, initialData, site, darkCss }: Props) {
  const [version, setVersion] = useState(initialVersion)
  // How the canvas looks only; nothing about it is saved with the page.
  const [dark, setDark] = useState(false)
  // Stable between renders (a new override would remount the canvas); changes only with the toggle.
  const overrides = useMemo(
    () => ({
      preview: ({ children }: { children: React.ReactNode }) => (
        <div className="editor-canvas" data-mode={dark ? 'dark' : 'light'}>
          {children}
        </div>
      ),
    }),
    [dark],
  )
  // Blocks read site settings and fetch live pets through Puck's metadata.
  const metadata: PuckSiteMetadata = { site, fetchPets: fetchPetsAction, fetchPet: fetchPetSpotlightAction, fetchPetProfiles: fetchPetProfilesAction }

  return (
    <>
    {/* Constant CSS from validated theme values, scoped to the canvas wrapper. */}
    {darkCss && <style dangerouslySetInnerHTML={{ __html: darkCss }} />}
    <Puck
      config={config}
      data={initialData}
      metadata={metadata}
      headerTitle={title}
      headerPath={slug === 'home' ? '/' : `/${slug}`}
      // The preview renders in the page itself so it picks up the site's real styles.
      iframe={{ enabled: false }}
      // Wraps the canvas so the site's dark colours can apply to the blocks only, not to the editor.
      overrides={overrides}
      renderHeaderActions={({ state }) => (
        <HeaderActions
          pageId={pageId}
          slug={slug}
          status={status}
          data={state.data}
          version={version}
          onVersion={setVersion}
          dark={darkCss ? dark : null}
          onDarkChange={setDark}
        />
      )}
    />
    </>
  )
}
