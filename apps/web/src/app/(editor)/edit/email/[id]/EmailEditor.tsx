'use client'

import { Puck, useGetPuck, type Data } from '@puckeditor/core'
import Link from 'next/link'
import React, { createContext, useContext, useMemo, useState, useTransition } from 'react'

import type { EmailPurpose, RenderContext } from '@/lib/email-template'
import { emailBuilderConfig, type EmailBuilderMetadata } from '@/puck/email-config'
import { saveEmailTemplateAction, saveSystemEmailAction, sendEmailTemplateTestAction } from '@/server/actions/email-templates'

// The email builder for one template. Save checks the layout on the server (placeholders, links, the
// purpose's rules) and lists what to fix. "Send test" sends the layout as it is now, filled with
// sample values, to an address (the person's own by default). View-only roles get every field
// read-only and no buttons.

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

type EditorState = Pick<Props, 'target' | 'purpose' | 'defaultTo' | 'readOnly'> & { onProblems: (problems: string[]) => void }
const EditorContext = createContext<EditorState | null>(null)
const useEditor = () => {
  const value = useContext(EditorContext)
  if (!value) throw new Error('EmailEditor parts must be inside EditorContext')
  return value
}

const problemsOf = (fieldErrors: Record<string, string> | undefined) =>
  Object.entries(fieldErrors ?? {})
    .filter(([key]) => key.startsWith('template.'))
    .map(([, value]) => value)

// Replaces Puck's Publish button. `useGetPuck` reads the layout at the moment of the click.
function HeaderActions() {
  const { target, purpose, defaultTo, readOnly, onProblems } = useEditor()
  const getPuck = useGetPuck()
  const [pending, startTransition] = useTransition()
  const [to, setTo] = useState(defaultTo)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const failed = (verb: string, result: { error: string; fieldErrors?: Record<string, string> }) => {
    const problems = problemsOf(result.fieldErrors)
    onProblems(problems)
    setMessage({ ok: false, text: problems.length ? `${verb}: ${problems.length} ${problems.length === 1 ? 'thing' : 'things'} to fix.` : (result.fieldErrors?.to ?? result.error) })
  }

  const save = () =>
    startTransition(async () => {
      const data = getPuck().appState.data
      const result = target.kind === 'system' ? await saveSystemEmailAction(target.purpose, data) : await saveEmailTemplateAction(target.id, { data })
      if (!result.ok) return failed('Not saved', result)
      onProblems([])
      setMessage({ ok: true, text: 'Saved.' })
    })

  const sendTest = () =>
    startTransition(async () => {
      const result = await sendEmailTemplateTestAction(purpose, getPuck().appState.data, to)
      if (!result.ok) return failed('Not sent', result)
      onProblems([])
      setMessage({ ok: true, text: `Test sent to ${result.data.to}.` })
    })

  return (
    <div className="editor-actions">
      <span role="status" className={message?.ok === false ? 'editor-msg editor-msg-error' : 'editor-msg'}>
        {message?.text}
      </span>
      <Link href="/admin/settings/templates">All templates</Link>
      {readOnly ? (
        <span className="editor-msg">View only: your role cannot change email templates.</span>
      ) : (
        <>
          <label className="sr-only" htmlFor="email-test-to">
            Send a test to
          </label>
          <input id="email-test-to" className="email-test-to" type="email" value={to} onChange={(event) => setTo(event.target.value)} autoComplete="email" />
          <button type="button" disabled={pending} onClick={sendTest}>
            Send test
          </button>
          <button type="button" className="editor-primary" disabled={pending} onClick={save}>
            {pending ? 'Working…' : 'Save'}
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
  const editor = useMemo<EditorState>(() => ({ target, purpose, defaultTo, readOnly, onProblems: setProblems }), [target, purpose, defaultTo, readOnly])

  return (
    <EditorContext.Provider value={editor}>
      {problems.length ? (
        <div className="email-problems" role="alert">
          <p>Fix these first</p>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <button type="button" onClick={() => setProblems([])}>
            Close
          </button>
        </div>
      ) : null}
      <Puck
        config={config}
        data={initialData}
        metadata={metadata}
        headerTitle={name}
        headerPath={purposeLabel}
        iframe={{ enabled: false }}
        overrides={OVERRIDES}
        permissions={readOnly ? READ_ONLY : undefined}
      />
    </EditorContext.Provider>
  )
}
