'use client'

import { Puck, useGetPuck, type Config, type Data, type Plugin } from '@puckeditor/core'
import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react'
import { FiExternalLink, FiLoader, FiMoon, FiSun } from 'react-icons/fi'

import { Switch } from '@pet-adopt/ui/components/switch'
import { useEditorToast } from '../../EditorToast'
import type { PetPageData } from '@/lib/queries'
import { loadPluginBlockAction, type PetChoice } from '@/puck/actions'
import { config } from '@/puck/config'
import { stripTransient } from '@/puck/data'
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
  autosaveDraftAction,
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
  /** The live layout, or null when the page is not live. */
  publishedData: Data | null
  /** Page settings saved as a draft, waiting for the next publish. */
  detailsPending: boolean
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
type SaveKind = 'draft' | 'publish' | 'auto'

/** Where the draft stands: everything saved, changes waiting for autosave, a save running, or autosave stopped after a failure. */
type SaveState = 'saved' | 'unsaved' | 'saving' | 'paused'

type EditorState = {
  pageId: number
  slug: string
  status: string
  /** Save draft / Publish from the header (autosave goes through the same function). */
  save: (kind: 'draft' | 'publish') => void
  saveState: SaveState
  /** Publishing would change nothing: the page is live, its layout is the draft's, and no settings wait. */
  nothingToPublish: boolean
  /** Which save is running, if any (the buttons wait and say so). */
  running: SaveKind | null
  /** null when the site has no dark mode (no switch shown). */
  dark: boolean | null
  /** The theme's dark colours scoped to the canvas, or null without dark mode. */
  darkCss: string | null
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

// Inside Puck's iframe (`overrides.iframe`): the canvas is a real document of the chosen viewport's
// width, so the site's @media rules apply as on a phone or tablet. Puck copies the editor page's
// styles in (`syncHostStyles`): the site CSS, fonts and theme. The "Dark preview" colours are
// added here, scoped to this wrapper, because they must reach the blocks and nothing else.
function CanvasFrame({ children }: { children: React.ReactNode; document?: Document }) {
  const { dark, darkCss } = useEditor()
  return (
    <div className="editor-canvas" data-mode={dark ? 'dark' : 'light'}>
      {/* Constant CSS from validated theme values (forcedModeCss), scoped to this wrapper. */}
      {darkCss ? <style dangerouslySetInnerHTML={{ __html: darkCss }} /> : null}
      {children}
    </div>
  )
}

// Module-level, like VIEWPORTS: Puck picks a default viewport again whenever the iframe or viewport
// settings it gets are a new object, so an inline `{ enabled: true }` reset the chosen viewport on
// every render (every edit and save).
const IFRAME = { enabled: true }

// The viewport switcher under the canvas: widths around the site's own breakpoints (480 and 800 px).
const VIEWPORTS = [
  { width: 390, height: 'auto' as const, icon: 'Smartphone' as const, label: 'Phone' },
  { width: 768, height: 'auto' as const, icon: 'Tablet' as const, label: 'Tablet' },
  { width: 1280, height: 'auto' as const, icon: 'Monitor' as const, label: 'Laptop' },
  { width: '100%' as const, height: 'auto' as const, icon: 'FullWidth' as const, label: 'Full width' },
]

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

function Spinner() {
  return <FiLoader aria-hidden className="editor-spinner" />
}

// Replaces Puck's own Publish button (its `children`). The saving itself lives in PageEditor
// (`useDraftSaver`), shared with autosave. Save draft is the draft's status too: "Saved" and
// unavailable when there is nothing to save, "Autosaving…" with a spinner while autosave runs.
// The buttons use aria-disabled (not disabled), so focus stays on the button that was pressed.
function HeaderActions() {
  const { pageId, readOnly, save, saveState, running, nothingToPublish } = useEditor()
  const nothingToSave = saveState === 'saved'
  const saveBlocked = running !== null || nothingToSave
  return (
    <div className="editor-actions">
      <a href={`/admin/pages/${pageId}`} className="editor-back" aria-label="Back to page settings">
        ← Back
      </a>
      {readOnly ? (
        // No Save or Publish: say why, in the header where those buttons usually are.
        <span className="editor-msg">View only: your role cannot change pages.</span>
      ) : (
        <>
          {/* Fixed minimum widths (editor.css), so changing labels never move Back or undo/redo. A paused
              autosave is shown on the button itself (red outline, named for screen readers). */}
          <button
            type="button"
            className={saveState === 'paused' && running === null ? 'editor-save editor-save-paused' : 'editor-save'}
            aria-disabled={saveBlocked}
            onClick={() => !saveBlocked && save('draft')}
          >
            {running === 'auto' ? (
              <>
                <Spinner /> Autosaving…
              </>
            ) : running === 'draft' ? (
              <>
                <Spinner /> Saving…
              </>
            ) : nothingToSave ? (
              'Saved'
) : saveState === 'paused' ? (
              <>
                Save draft<span className="sr-only"> (autosave paused)</span>
              </>
            ) : (
              'Save draft'
            )}
          </button>
          <button
            type="button"
            className="editor-primary editor-publish"
            aria-disabled={running !== null || nothingToPublish}
            title={nothingToPublish ? 'The live page already shows this layout.' : undefined}
            onClick={() => running === null && !nothingToPublish && save('publish')}
          >
            {running === 'publish' ? (
              <>
                <Spinner /> Publishing…
              </>
            ) : (
              'Publish'
            )}
          </button>
        </>
      )}
    </div>
  )
}

/**
 * What would be saved, to tell real edits apart: the layout without the props filled in at render
 * (so a preview change is not an edit), with empty `zones` and a missing `root` read the same as
 * Puck's own empty ones (so opening a page is not an edit either).
 */
function snapshotOf(data: Data): string {
  const clean = stripTransient(data)
  const zones = clean.zones && Object.keys(clean.zones).length ? clean.zones : undefined
  return stableJson({ root: { props: clean.root?.props ?? {} }, content: clean.content ?? [], zones })
}

/** JSON with object keys sorted: PostgreSQL's jsonb stores keys in its own order, so a saved layout
 * read back must still compare equal to the same layout in the editor. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  )
}
/** Autosave runs this long after the last change. */
const AUTOSAVE_MS = 3000

/**
 * Saving the draft: Save draft, Publish and autosave all go through `save`, one at a time, each sent
 * with the version the last save returned (a page changed elsewhere is refused, not overwritten).
 * Autosave runs 3 s after the last change that differs from what was last saved, and when the tab
 * is hidden. A failed autosave pauses it (the error comes as a toast) until a save works again, so a
 * conflict is not retried every few seconds. Leaving with unsaved work asks first.
 */
function useDraftSaver({
  pageId,
  initialVersion,
  initialData,
  publishedData,
  detailsPending,
  readOnly,
  show,
  onPublished,
}: {
  pageId: number
  initialVersion: number
  initialData: Data
  publishedData: Data | null
  detailsPending: boolean
  readOnly: boolean
  show: (message: { ok: boolean; text: string }) => void
  onPublished: () => void
}) {
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [runningKind, setRunningKind] = useState<SaveKind | null>(null)
  const version = useRef(initialVersion)
  const saved = useRef(snapshotOf(initialData))
  // What is live (null: nothing), and settings waiting for a publish; both cleared by a publish.
  const live = useRef(publishedData ? snapshotOf(publishedData) : null)
  const settingsWaiting = useRef(detailsPending)
  const [nothingToPublish, setNothingToPublish] = useState(() => !detailsPending && publishedData !== null && snapshotOf(publishedData) === snapshotOf(initialData))
  const checkPublish = useCallback((data: Data) => {
    setNothingToPublish(!settingsWaiting.current && live.current !== null && live.current === snapshotOf(data))
  }, [])
  const latest = useRef(initialData)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const running = useRef(false)
  const paused = useRef(false)
  // The current `run`, for timers (it is defined below and changes with its inputs).
  const runLater = useRef<(kind: 'auto') => Promise<void>>(async () => {})
  const schedule = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void runLater.current('auto'), AUTOSAVE_MS)
  }, [])

  const run = useCallback(
    async (kind: SaveKind) => {
      if (readOnly) return
      clearTimeout(timer.current)
      const data = latest.current
      const snapshot = snapshotOf(data)
      if (kind === 'auto' && (paused.current || snapshot === saved.current)) return
      if (running.current) {
        // One save at a time: an autosave tries again shortly; the buttons are disabled meanwhile.
        if (kind === 'auto') schedule()
        return
      }
      running.current = true
      setRunningKind(kind)
      setSaveState('saving')
      const action = kind === 'publish' ? publishAction : kind === 'auto' ? autosaveDraftAction : saveDraftAction
      const result = await action(pageId, data, version.current).catch(() => ({ ok: false as const, message: 'Could not reach the server. Check your connection.' }))
      running.current = false
      setRunningKind(null)
      if (result.ok) {
        version.current = result.version
        saved.current = snapshot
        paused.current = false
        if (kind === 'publish') {
          live.current = snapshot
          settingsWaiting.current = false
          onPublished()
        }
        if (kind !== 'auto') show({ ok: true, text: result.message })
      } else if (kind === 'auto') {
        paused.current = true
        show({ ok: false, text: `Autosave paused: ${result.message}` })
      } else {
        show({ ok: false, text: result.message })
      }
      checkPublish(latest.current)
      // Edits made while it was saving: still unsaved, and autosave picks them up.
      const dirty = snapshotOf(latest.current) !== saved.current
      setSaveState(paused.current ? 'paused' : dirty ? 'unsaved' : 'saved')
      if (dirty && !paused.current) schedule()
    },
    [pageId, readOnly, show, onPublished, schedule, checkPublish],
  )

  // Puck's onChange: every edit (and every data lookup a block finishes, which the snapshot ignores).
  const onChange = useCallback(
    (data: Data) => {
      latest.current = data
      if (readOnly) return
      checkPublish(data)
      const dirty = snapshotOf(data) !== saved.current
      if (!running.current) setSaveState(paused.current ? 'paused' : dirty ? 'unsaved' : 'saved')
      clearTimeout(timer.current)
      if (dirty && !paused.current) schedule()
    },
    [readOnly, schedule, checkPublish],
  )

  useEffect(() => {
    runLater.current = run
  }, [run])
  const save = useCallback((kind: 'draft' | 'publish') => void run(kind), [run])

  // Switching tabs or minimising saves at once; closing the tab with unsaved work asks first.
  useEffect(() => {
    if (readOnly) return
    const onHide = () => {
      if (document.visibilityState === 'hidden') void run('auto')
    }
    const onLeave = (event: BeforeUnloadEvent) => {
      if (running.current || snapshotOf(latest.current) !== saved.current) event.preventDefault()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', onLeave)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onLeave)
      clearTimeout(timer.current)
    }
  }, [readOnly, run])

  return { onChange, save, saveState, running: runningKind, nothingToPublish }
}

// Module-level, so it is the same object on every render (see EditorContext).
const OVERRIDES = { iframe: CanvasFrame, headerActions: HeaderActions, fields: FieldsPanel }

// Every editing permission off: blocks cannot be dragged, added, changed, removed or copied, and
// Puck shows every field read-only (custom fields get `readOnly` too, see the pickers).
const READ_ONLY = { drag: false, duplicate: false, delete: false, edit: false, insert: false }

export function PageEditor({ pageId, title, slug, status: initialStatus, version: initialVersion, initialData, publishedData, detailsPending, site, darkCss, readOnly = false, petPreview = null }: Props) {
  const [status, setStatus] = useState(initialStatus)
  const { show, toast } = useEditorToast()
  const onPublished = useCallback(() => setStatus('published'), [])
  const saver = useDraftSaver({ pageId, initialVersion, initialData, publishedData, detailsPending, readOnly, show, onPublished })
  const { save, saveState, running, nothingToPublish } = saver
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
    () => ({ pageId, slug, status, save, saveState, running, nothingToPublish, dark: darkCss ? dark : null, darkCss, onDarkChange: setDark, readOnly, petPicker }),
    [pageId, slug, status, save, saveState, running, nothingToPublish, darkCss, dark, readOnly, petPicker],
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
      fetchPluginBlock: loadPluginBlockAction,
      ...(isPetPage ? { pet, fetchSimilarPets: fetchSimilarPetsAction } : {}),
    }),
    [site, isPetPage, pet],
  )

  return (
    <EditorContext.Provider value={editor}>
    {toast}
    <Puck
      config={isPetPage ? PET_PAGE_CONFIG : SITE_CONFIG}
      data={initialData}
      metadata={metadata}
      onChange={saver.onChange}
      headerTitle={title}
      headerPath={isPetPage ? '/pets/…' : slug === 'home' ? '/' : `/${slug}`}
      // The canvas is an iframe (Puck copies this page's styles into it), so the viewport switcher
      // under it shows the site at phone and tablet widths with its real @media rules.
      iframe={IFRAME}
      viewports={VIEWPORTS}
      // The header buttons replace Puck's default Publish (the deprecated `renderHeaderActions`).
      overrides={OVERRIDES}
      plugins={PLUGINS}
      permissions={readOnly ? READ_ONLY : undefined}
    />
    </EditorContext.Provider>
  )
}
