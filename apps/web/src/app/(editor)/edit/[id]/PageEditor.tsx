'use client'

import { Puck, useGetPuck, type Config, type Data, type Plugin } from '@puckeditor/core'
import React, { createContext, useContext, useEffect, useId, useMemo, useState, useTransition } from 'react'
import { FiExternalLink, FiMoon, FiSun } from 'react-icons/fi'

import { Switch } from '@pet-adopt/ui/components/switch'
import { useEditorToast } from '../../EditorToast'
import type { PetPageData } from '@/lib/queries'
import type { PetChoice } from '@/puck/actions'
import { config } from '@/puck/config'
import { petPageConfig } from '@/puck/pet-page-config'
import type { PuckSiteMetadata } from '@/puck/types'

import {
  fetchCatalogAction,
  fetchFormAction,
  fetchPetPagePreviewAction,
  fetchPetProfilesAction,
  fetchPetsAction,
  fetchPetSpotlightAction,
  fetchSimilarPetsAction,
  publishAction,
  saveDraftAction,
} from './actions'

// Puck takes one config type per editor; the two block sets are widened to it here.
const SITE_CONFIG = config as unknown as Config
const PET_PAGE_CONFIG = petPageConfig as unknown as Config

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
  /** View-only roles (audit): everything can be looked at, nothing changed or saved. */
  readOnly?: boolean
  /** Only for the Pet page template: the pets it can be previewed with, and the first one. */
  petPreview?: { choices: PetChoice[]; pet: PetPageData | null } | null
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
  /** After a publish in the builder: the page is live now (for "View live"). */
  onPublished: () => void
  /** null when the site has no dark mode (no switch shown). */
  dark: boolean | null
  onDarkChange: (dark: boolean) => void
  readOnly: boolean
  /** The Pet page template's "Preview with" picker; null on every other page. */
  petPicker: { choices: PetChoice[]; pet: PetPageData | null; onPick: (id: number) => void; loading: boolean } | null
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

// The address "View live" opens, or null while there is none: the page is not live, or (Pet page
// template, which has no address of its own) no pet is picked; then it opens the previewed pet's page.
function useLivePath(): string | null {
  const { slug, status, petPicker } = useEditor()
  if (status !== 'published') return null
  if (petPicker) return petPicker.pet ? `/pets/${petPicker.pet.slug}` : null
  return slug === 'home' ? '/' : `/${slug}`
}

// "View live" in Puck's left rail, beside Blocks and Outline. Puck's rail items are clickable divs
// that switch panels; this one's icon is a real link stretched over the whole item (editor.css), so
// it opens the live page in a new tab, works from the keyboard, and stops the click from switching
// panels. Not live yet: a plain icon, and the click opens the panel below, which says why.
function ViewLiveIcon() {
  const href = useLivePath()
  if (!href) return <FiExternalLink aria-hidden />
  return (
    <a href={href} target="_blank" rel="noreferrer" className="editor-nav-link" aria-label="View live (opens in a new tab)" onClick={(event) => event.stopPropagation()}>
      <FiExternalLink aria-hidden />
    </a>
  )
}
function ViewLivePanel() {
  const { petPicker } = useEditor()
  const href = useLivePath()
  return (
    <div className="editor-panel-note">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer">
          Open the live page
        </a>
      ) : petPicker && petPicker.pet === null ? (
        <p>Pick a pet in “Preview with” (right sidebar) to open its page.</p>
      ) : (
        <p>This page is not live yet. Publish it to see it on the site.</p>
      )}
    </div>
  )
}
const VIEW_LIVE_PLUGIN: Plugin = { name: 'view-live', label: 'View live', icon: <ViewLiveIcon />, render: ViewLivePanel }
const PLUGINS = [VIEW_LIVE_PLUGIN]

// Puck's right sidebar: the preview controls (what only changes how the canvas looks, never saved)
// stay at its top whatever is selected, above the selected block's fields.
function FieldsPanel({ children }: { children: React.ReactNode; isLoading: boolean; itemSelector?: unknown }) {
  const { dark, onDarkChange, petPicker } = useEditor()
  if (dark === null && !petPicker) return <>{children}</>
  return (
    <>
      <div className="editor-preview-panel" role="group" aria-labelledby="editor-preview-heading">
        <p id="editor-preview-heading" className="editor-preview-heading">
          Preview
        </p>
        <PetPicker />
        {dark !== null && (
          // shadcn Switch (a button with role="switch"): its name says what it does, the icons only show it.
          <span className="editor-mode-switch">
            <span>Dark preview</span>
            <FiSun aria-hidden />
            <Switch checked={dark} onCheckedChange={(checked) => onDarkChange(checked)} aria-label="Dark preview" />
            <FiMoon aria-hidden />
          </span>
        )}
        <p className="editor-preview-hint">Only changes how the canvas looks. Nothing here is saved.</p>
      </div>
      {children}
    </>
  )
}

// "Preview with": which pet the Pet page template is drawn with in the editor. Nothing about it is
// saved. Picking one re-runs "More pets like this" (Puck only re-resolves a block when its own props
// change, or when forced).
function PetPicker() {
  const { petPicker } = useEditor()
  const getPuck = useGetPuck()
  const id = useId()
  const petId = petPicker?.pet?.id ?? null
  useEffect(() => {
    if (petId === null) return
    // After Puck has copied the new metadata into its store (its own effect, which runs after ours).
    const timer = setTimeout(() => {
      const { appState, resolveDataById } = getPuck()
      for (const item of appState.data.content) if (item.type === 'MorePets') resolveDataById(item.props.id as string, 'force')
    }, 0)
    return () => clearTimeout(timer)
  }, [petId, getPuck])
  if (!petPicker) return null
  return (
    <span className="editor-pet-picker">
      <label htmlFor={id}>Preview with</label>
      <select id={id} value={petId ?? ''} disabled={petPicker.loading || !petPicker.choices.length} onChange={(event) => petPicker.onPick(Number(event.target.value))}>
        {!petPicker.choices.length ? <option value="">No pets yet</option> : null}
        {petPicker.choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.note ? `${choice.name} (${choice.note})` : choice.name}
          </option>
        ))}
      </select>
      {petPicker.pet ? (
        // In a new tab, so unsaved work here is kept; the preview reloads the pet when this tab is back.
        <a className="editor-pet-edit" href={`/admin/pets/${petPicker.pet.id}`} target="_blank" rel="noreferrer">
          Edit {petPicker.pet.name}
          <FiExternalLink aria-hidden />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : null}
    </span>
  )
}

// Replaces Puck's own Publish button (its `children`). `useGetPuck` reads the layout at the moment
// of the click, so typing in the editor does not re-render the header.
function HeaderActions() {
  const { pageId, version, onVersion, onPublished, readOnly } = useEditor()
  const getPuck = useGetPuck()
  const [pending, startTransition] = useTransition()
  const { show, toast } = useEditorToast()

  const run = (action: typeof saveDraftAction) =>
    startTransition(async () => {
      const data: Data = getPuck().appState.data
      const result = await action(pageId, data, version)
      // Every successful save returns the new version; the next one must be based on it.
      if (result.ok) onVersion(result.version)
      if (result.ok && action === publishAction) onPublished()
      show({ ok: result.ok, text: result.message })
    })

  return (
    <div className="editor-actions">
      {toast}
      <a href={`/admin/pages/${pageId}`} className="editor-back" aria-label="Back to page settings">
        ← Back
      </a>
      {readOnly ? (
        // No Save or Publish: say why, in the header where those buttons usually are.
        <span className="editor-msg">View only: your role cannot change pages.</span>
      ) : (
        <>
          <button type="button" disabled={pending} onClick={() => run(saveDraftAction)}>
            Save draft
          </button>
          <button type="button" className="editor-primary" disabled={pending} onClick={() => run(publishAction)}>
            {pending ? 'Working…' : 'Publish'}
          </button>
        </>
      )}
    </div>
  )
}

// Module-level, so it is the same object on every render (see EditorContext).
const OVERRIDES = { preview: CanvasWrapper, headerActions: HeaderActions, fields: FieldsPanel }

// Every editing permission off: blocks cannot be dragged, added, changed, removed or copied, and
// Puck shows every field read-only (custom fields get `readOnly` too, see the pickers).
const READ_ONLY = { drag: false, duplicate: false, delete: false, edit: false, insert: false }

export function PageEditor({ pageId, title, slug, status: initialStatus, version: initialVersion, initialData, site, darkCss, readOnly = false, petPreview = null }: Props) {
  const [version, setVersion] = useState(initialVersion)
  const [status, setStatus] = useState(initialStatus)
  // How the canvas looks only; nothing about it is saved with the page.
  const [dark, setDark] = useState(false)
  // The Pet page template's preview pet (only how the canvas looks, like `dark`).
  const [pet, setPet] = useState<PetPageData | null>(petPreview?.pet ?? null)
  const [loadingPet, startPetLoad] = useTransition()
  // Back from editing the pet in another tab ("Edit <name>"): load it again so the canvas shows the changes.
  const petIdForReload = pet?.id ?? null
  useEffect(() => {
    if (petIdForReload === null) return
    const reload = () => {
      if (document.visibilityState !== 'visible') return
      startPetLoad(async () => {
        const fresh = await fetchPetPagePreviewAction(petIdForReload)
        if (fresh) setPet(fresh)
      })
    }
    document.addEventListener('visibilitychange', reload)
    return () => document.removeEventListener('visibilitychange', reload)
  }, [petIdForReload])
  const choices = petPreview?.choices
  const petPicker = useMemo<EditorState['petPicker']>(
    () =>
      choices
        ? {
            choices,
            pet,
            loading: loadingPet,
            onPick: (id) =>
              startPetLoad(async () => {
                setPet(await fetchPetPagePreviewAction(id))
              }),
          }
        : null,
    [choices, pet, loadingPet],
  )
  const editor = useMemo<EditorState>(
    () => ({ pageId, slug, status, version, onVersion: setVersion, onPublished: () => setStatus('published'), dark: darkCss ? dark : null, onDarkChange: setDark, readOnly, petPicker }),
    [pageId, slug, status, version, darkCss, dark, readOnly, petPicker],
  )
  // Blocks read site settings and fetch live pets through Puck's metadata. Memoised: Puck copies a
  // new metadata object into its store, so a fresh one on every render would redo that each time.
  const isPetPage = Boolean(petPreview)
  const metadata = useMemo<PuckSiteMetadata>(
    () => ({
      site,
      fetchPets: fetchPetsAction,
      fetchPet: fetchPetSpotlightAction,
      fetchPetProfiles: fetchPetProfilesAction,
      fetchCatalog: () => fetchCatalogAction(),
      fetchForm: fetchFormAction,
      ...(isPetPage ? { pet, fetchSimilarPets: fetchSimilarPetsAction } : {}),
    }),
    [site, isPetPage, pet],
  )

  return (
    <EditorContext.Provider value={editor}>
    {/* Constant CSS from validated theme values, scoped to the canvas wrapper. */}
    {darkCss && <style dangerouslySetInnerHTML={{ __html: darkCss }} />}
    <Puck
      config={isPetPage ? PET_PAGE_CONFIG : SITE_CONFIG}
      data={initialData}
      metadata={metadata}
      headerTitle={title}
      headerPath={isPetPage ? '/pets/…' : slug === 'home' ? '/' : `/${slug}`}
      // The preview renders in the page itself so it picks up the site's real styles.
      iframe={{ enabled: false }}
      // Wraps the canvas so the site's dark colours can apply to the blocks only, not to the editor.
      // The header buttons replace Puck's default Publish (the deprecated `renderHeaderActions`).
      overrides={OVERRIDES}
      plugins={PLUGINS}
      permissions={readOnly ? READ_ONLY : undefined}
    />
    </EditorContext.Provider>
  )
}
