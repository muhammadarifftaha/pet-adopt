// The Form block: the half the page builder loads in the browser and the site draws on the server
// (see "Page builder blocks" in @pet-adopt/plugin-sdk). So: no hooks, no browser-only code and no
// server-only imports. Two imports are references, not code, in the browser: the visitor's form
// (./public-form, a 'use client' component) and the forms list for the picker (./actions, a
// 'use server' file). What it shows comes from the plugin's loader (`loadFormBlock` in
// ./server.ts) as `data`: the form and the live privacy policy.
//
// It was a built-in block of the site before it moved here, so its name and options are the ones
// pages were saved with (`formId`, `heading`, `showDescription`, `background`), and they must stay.
// The site checks saved options against the fields below before `render` and the loader see them;
// the background still goes into a class name only when it is one of the three choices, in case a
// future site version checks less.

import { definePluginBlock } from '@pet-adopt/plugin-sdk'

import { listFormChoicesAction } from './actions'
import { FORM_BLOCK_CSS } from './block-css'
import { FORM_BLOCK, FORM_BUILDER } from './names'
import { PublicForm } from './public-form'
import type { FormBlockData } from './server'

export type { FormBlockData }

type Background = 'none' | 'tint' | 'dark'
const BACKGROUNDS: readonly Background[] = ['none', 'tint', 'dark']

export type FormBlockProps = {
  /** The form's id, or null for none (a number; the picker keeps it one). */
  formId: number | string | null
  /** Blank shows the form's own name. */
  heading: string
  showDescription: boolean
  background: Background
}

/** The site's section band (the same markup as its built-in blocks). */
function Band({ background, children }: { background: unknown; children: React.ReactNode }) {
  const band = BACKGROUNDS.includes(background as Background) ? (background as Background) : 'none'
  return (
    <section className={`section section-${band} spacing-md align-left`}>
      <div className="container">{children}</div>
    </section>
  )
}

const paragraphs = (text: string | null | undefined) =>
  (text ?? '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

export const formBlock = definePluginBlock<FormBlockProps, FormBlockData>({
  name: FORM_BLOCK,
  label: 'Form',
  plugin: FORM_BUILDER,
  // A deleted form (or a form builder that is not set up) hides the block on the live site.
  needsData: true,
  // The heading falls back to the form's name, so the block has one whenever its form is there.
  headingFromData: true,
  // Offered in the Pet page template too (an adoption application under every pet).
  petPage: true,
  // The loader reads only the form; a new heading or background redraws without asking again.
  dataOptions: ['formId'],
  fields: {
    formId: { type: 'choice', label: 'Form', load: listFormChoicesAction, empty: 'Choose a form' },
    heading: { type: 'text', label: "Heading (blank uses the form's name)" },
    showDescription: {
      type: 'radio',
      label: "Show the form's description",
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    background: {
      type: 'radio',
      label: 'Background',
      options: [
        { label: 'Plain', value: 'none' },
        { label: 'Tinted', value: 'tint' },
        { label: 'Dark', value: 'dark' },
      ],
    },
  },
  defaultProps: { formId: null, heading: '', showDescription: true, background: 'none' },
  css: FORM_BLOCK_CSS,
  render: ({ formId, heading, showDescription, background, data, editing, headingLevel }) => {
    const form = data && typeof data === 'object' && data.form && typeof data.form === 'object' ? data.form : null
    if (!form) {
      if (!editing) return null
      return (
        <Band background={background}>
          <p className="muted">{formId ? 'This form could not be found or loaded: it may have been deleted, or the site could not read it just now. While that lasts, the block is hidden on the site.' : 'Choose a form. Forms are made under Plugins, Forms.'}</p>
        </Band>
      )
    }
    const Heading = headingLevel === 1 ? 'h1' : 'h2'
    // The policy is a page of the site: only a site path is linked.
    const privacy = data?.privacy && typeof data.privacy.href === 'string' && /^\/(?![\/\\])/.test(data.privacy.href) && typeof data.privacy.title === 'string' ? data.privacy : null
    return (
      <Band background={background}>
        <div className="fb-form-section">
          <Heading className="block-heading">{(typeof heading === 'string' ? heading.trim() : '') || form.name}</Heading>
          {showDescription !== false &&
            paragraphs(form.description).map((paragraph, index) => (
              <p key={index} className="fb-form-intro">
                {paragraph}
              </p>
            ))}
          <PublicForm form={form} preview={editing} privacy={privacy ? { title: privacy.title, href: privacy.href } : null} />
        </div>
      </Band>
    )
  },
})
