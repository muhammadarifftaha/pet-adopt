'use client'

import { Puck, useGetPuck, type Data } from '@puckeditor/core'
import React, { createContext, useContext, useMemo, useState, useTransition } from 'react'
import { FiMoon, FiSun } from 'react-icons/fi'

import { Switch } from '@pet-adopt/ui/components/switch'
import { config } from '@/puck/config'
import type { PuckSiteMetadata } from '@/puck/types'

import { fetchCatalogAction, fetchFormAction, fetchPetProfilesAction, fetchPetsAction, fetchPetSpotlightAction, publishAction, saveDraftAction } from './actions'

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

// What the header buttons and the canvas wrapper need. Passed through context so the `overrides`
// object Puck receives never changes: a new override component would remount that part of the
// editor (the whole canvas, for `preview`) on every save or dark-mode switch.
type EditorState = {
  pageId: number
  slug: string
  status: string
  version: number
  onVersion: (version: number) => void
  /** null when the site has no dark mode (no switch shown). */
  dark: boolean | null
  onDarkChange: (dark: boolean) => void
}
const EditorContext = createContext<EditorState | null>(null)
const useEditor = () => {
  const value = useContext(EditorContext)
  if (!value) throw new Error('PageEditor parts must be inside EditorContext')
  return value
}

function CanvasWrapper({ children }: { children: React.ReactNode }) {
  const { dark } = useEditor()
  return (
    <div className="editor-canvas" data-mode={dark ? 'dark' : 'light'}>
      {children}
    </div>
  )
}

// Replaces Puck's own Publish button (its `children`). `useGetPuck` reads the layout at the moment
// of the click, so typing in the editor does not re-render the header.
function HeaderActions() {
  const { pageId, slug, status, version, onVersion, dark, onDarkChange } = useEditor()
  const getPuck = useGetPuck()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const run = (action: typeof saveDraftAction) =>
    startTransition(async () => {
      const data: Data = getPuck().appState.data
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

// Module-level, so it is the same object on every render (see EditorContext).
const OVERRIDES = { preview: CanvasWrapper, headerActions: HeaderActions }

export function PageEditor({ pageId, title, slug, status, version: initialVersion, initialData, site, darkCss }: Props) {
  const [version, setVersion] = useState(initialVersion)
  // How the canvas looks only; nothing about it is saved with the page.
  const [dark, setDark] = useState(false)
  const editor = useMemo<EditorState>(
    () => ({ pageId, slug, status, version, onVersion: setVersion, dark: darkCss ? dark : null, onDarkChange: setDark }),
    [pageId, slug, status, version, darkCss, dark],
  )
  // Blocks read site settings and fetch live pets through Puck's metadata.
  const metadata: PuckSiteMetadata = { site, fetchPets: fetchPetsAction, fetchPet: fetchPetSpotlightAction, fetchPetProfiles: fetchPetProfilesAction, fetchCatalog: () => fetchCatalogAction(), fetchForm: fetchFormAction }

  return (
    <EditorContext.Provider value={editor}>
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
      // The header buttons replace Puck's default Publish (the deprecated `renderHeaderActions`).
      overrides={OVERRIDES}
    />
    </EditorContext.Provider>
  )
}
