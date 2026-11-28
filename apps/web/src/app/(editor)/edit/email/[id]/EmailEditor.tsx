'use client'

import type { ActionResult } from '@pet-adopt/plugin-sdk'
import { Puck, useGetPuck, type Data } from '@puckeditor/core'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from 'react'

import type { EmailPurpose, RenderContext } from '@/lib/email-template'
import { emailBuilderConfig, type EmailBuilderMetadata } from '@/puck/email-config'
import { saveEmailTemplateAction, saveSystemEmailAction, sendEmailTemplateTestAction } from '@/server/actions/email-templates'

import { useEditorToast } from '../../../EditorToast'

// The email builder for one template. Save checks the layout on the server (placeholders, links, the
// purpose's rules) and lists what to fix. "Send test" sends the layout as it is now, filled with
// sample values, to an address (the person's own by default). View-only roles get every field
// read-only and no buttons. There is no autosave: leaving with unsaved changes asks first.

/** A library template (form emails), or one of the site's own emails, edited in place. */
type Target = { kind: 'template'; id: number } | { kind: 'system'; purpose: string }

type Props = {
  target: Target
  name: string
  purpose: EmailPurpose
  purposeLabel: string
  initialData: Data
  ctx: RenderContext
  defaultTo: string
  readOnly: boolean
}

type EditorState = Pick<Props, 'target' | 'purpose' | 'defaultTo' | 'readOnly'> & {
  onProblems: (problems: string[]) => void
  /** Whether the "Fix these first" list is showing (Save is described by it). */
  hasProblems: boolean
  /** The layout was saved: what the unsaved-changes check compares with from now on. */
  onSaved: (data: Data) => void
  /** Save, so focus can go back to it when the list of problems is closed. */
  saveButton: React.RefObject<HTMLButtonElement | null>
}
const EditorContext = createContext<EditorState | null>(null)
const useEditor = () => {
  const value = useContext(EditorContext)
  if (!value) throw new Error('EmailEditor parts must be inside EditorContext')
  return value
}

const PROBLEMS_ID = 'email-problems'
const PROBLEMS_TITLE_ID = 'email-problems-title'
/** What a call that never reached the server (lost connection, server down) reports. */
const UNREACHABLE = { ok: false as const, error: 'Could not reach the server. Check your connection.' }

const problemsOf = (fieldErrors: Record<string, string> | undefined) =>
  Object.entries(fieldErrors ?? {})
    .filter(([key]) => key.startsWith('template.'))
    .map(([, value]) => value)

/**
 * What would be saved, to tell real edits apart: object keys sorted (the database may return them in
 * another order), and empty `zones` and a missing `root` read the same as Puck's own empty ones.
 */
function snapshotOf(data: Data): string {
  const zones = data.zones && Object.keys(data.zones).length ? data.zones : undefined
  return JSON.stringify({ root: { props: data.root?.props ?? {} }, content: data.content ?? [], zones }, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  )
}

// Replaces Puck's Publish button. `useGetPuck` reads the layout at the moment of the click.
// The buttons use aria-disabled (not disabled) while working, so focus stays on the one pressed.
function HeaderActions() {
  const { target, purpose, defaultTo, readOnly, onProblems, hasProblems, onSaved, saveButton } = useEditor()
  const getPuck = useGetPuck()
  const [pending, startTransition] = useTransition()
  const [running, setRunning] = useState<'save' | 'test' | null>(null)
  const [to, setTo] = useState(defaultTo)
  const { show, toast } = useEditorToast()

  const failed = (verb: string, result: { error: string; fieldErrors?: Record<string, string> }) => {
    const problems = problemsOf(result.fieldErrors)
    onProblems(problems)
    show({
      ok: false,
      text: problems.length
        ? `${verb}: ${problems.length} ${problems.length === 1 ? 'thing' : 'things'} to fix, listed at the top right.`
        : `${verb}: ${result.fieldErrors?.to ?? result.error}`,
    })
  }

  const save = () => {
    if (pending) return
    setRunning('save')
    startTransition(async () => {
      const data = getPuck().appState.data
      const send = async (): Promise<ActionResult<unknown>> =>
        target.kind === 'system' ? saveSystemEmailAction(target.purpose, data) : saveEmailTemplateAction(target.id, { data })
      const result = await send().catch(() => UNREACHABLE)
      if (!result.ok) return failed('Not saved', result)
      onSaved(data)
      onProblems([])
      show({ ok: true, text: 'Saved.' })
    })
  }

  const sendTest = () => {
    if (pending) return
    setRunning('test')
    startTransition(async () => {
      const result = await sendEmailTemplateTestAction(purpose, getPuck().appState.data, to).catch(() => UNREACHABLE)
      if (!result.ok) return failed('Not sent', result)
      onProblems([])
      show({ ok: true, text: `Test sent to ${result.data.to}.` })
    })
  }

  return (
    <div className="editor-actions">
      {toast}
      {/* A plain link (a full page load, as the admin is another root layout anyway), so leaving with
          unsaved changes gets the browser's prompt. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/admin/email/templates">All templates</a>
      {readOnly ? (
        <span className="editor-msg">View only: your role cannot change email templates.</span>
      ) : (
        <>
          <label className="email-test-label" htmlFor="email-test-to">
            Send test to
          </label>
          <input id="email-test-to" className="email-test-to" type="email" value={to} onChange={(event) => setTo(event.target.value)} autoComplete="email" />
          <button type="button" aria-disabled={pending} onClick={sendTest}>
            {pending && running === 'test' ? 'Sending…' : 'Send test'}
          </button>
          <button
            ref={saveButton}
            type="button"
            className="editor-primary"
            aria-disabled={pending}
            aria-describedby={hasProblems ? PROBLEMS_ID : undefined}
            onClick={save}
          >
            {pending && running === 'save' ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    </div>
  )
}

// Module-level, so Puck gets the same object on every render.
const OVERRIDES = { headerActions: HeaderActions }
const READ_ONLY = { drag: false, duplicate: false, delete: false, edit: false, insert: false }

export function EmailEditor({ target, name, purpose, purposeLabel, initialData, ctx, defaultTo, readOnly }: Props) {
  const [problems, setProblems] = useState<string[]>([])
  const config = useMemo(() => emailBuilderConfig(purpose), [purpose])
  const metadata = useMemo<EmailBuilderMetadata>(() => ({ ctx }), [ctx])
  const saveButton = useRef<HTMLButtonElement | null>(null)

  // Unsaved changes: the layout as last saved, and as it is now (Puck's onChange).
  const saved = useRef(snapshotOf(initialData))
  const latest = useRef(initialData)
  const onChange = useCallback((data: Data) => {
    latest.current = data
  }, [])
  const onSaved = useCallback((data: Data) => {
    saved.current = snapshotOf(data)
  }, [])
  // Reloading, closing the tab or leaving through "All templates" with unsaved changes asks first.
  useEffect(() => {
    if (readOnly) return
    const onLeave = (event: BeforeUnloadEvent) => {
      if (snapshotOf(latest.current) === saved.current) return
      event.preventDefault()
      // Older browsers need returnValue set to show the prompt.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [readOnly])

  const hasProblems = problems.length > 0
  const editor = useMemo<EditorState>(
    () => ({ target, purpose, defaultTo, readOnly, onProblems: setProblems, hasProblems, onSaved, saveButton }),
    [target, purpose, defaultTo, readOnly, hasProblems, onSaved],
  )

  return (
    <EditorContext.Provider value={editor}>
      {hasProblems ? (
        // Announced by the error toast; Save points at it with aria-describedby.
        <section id={PROBLEMS_ID} className="email-problems" aria-labelledby={PROBLEMS_TITLE_ID}>
          <p id={PROBLEMS_TITLE_ID}>Fix these first</p>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setProblems([])
              // The Close button is about to go: focus moves to Save, where the list came from.
              saveButton.current?.focus()
            }}
          >
            Close
          </button>
        </section>
      ) : null}
      <Puck
        config={config}
        data={initialData}
        metadata={metadata}
        onChange={onChange}
        headerTitle={name}
        headerPath={purposeLabel}
        iframe={{ enabled: false }}
        overrides={OVERRIDES}
        permissions={readOnly ? READ_ONLY : undefined}
      />
    </EditorContext.Provider>
  )
}
