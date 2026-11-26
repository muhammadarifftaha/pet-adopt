'use client'

import type { Config, Fields } from '@puckeditor/core'
import React from 'react'

import { blockHtml, footerHtml, linkPlaceholdersFor, LOGO_DEFAULTS, logoHtml, placeholdersFor, PURPOSE_INFO, type BlockData, type EmailPurpose, type RenderContext, type TemplateRoot } from '@/lib/email-template'

import { MediaPicker } from './media-picker'
import type { MediaValue } from './types'

// The email builder's blocks (Puck). Each one draws exactly the HTML the email will contain
// (blockHtml in src/lib/email-template.ts, which escapes everything typed), so the canvas is the
// email. Placeholders show as {{name}} chips. Only Columns and the root draw their own markup here
// (with the same styles), because Puck needs its drop areas inside them. The config depends on the
// purpose: the Details block only exists for team notifications.

/** What the canvas needs to draw blocks: theme, logo, site name. Passed as Puck metadata. */
export type EmailBuilderMetadata = { ctx: RenderContext }

const align = {
  type: 'radio',
  label: 'Alignment',
  options: [
    { label: 'Left', value: 'left' },
    { label: 'Centre', value: 'center' },
    { label: 'Right', value: 'right' },
  ],
} as const

function Html({ html }: { html: string }) {
  // Built by blockHtml from validated, escaped values.
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}

function draw(type: BlockData['type'], props: Record<string, unknown>, metadata: unknown) {
  const { ctx } = metadata as EmailBuilderMetadata
  return <Html html={blockHtml({ type, props } as BlockData, { ...ctx, showPlaceholders: true })} />
}

/** The placeholders this kind of email may use, in the root's sidebar. */
function PlaceholderHelp({ purpose }: { purpose: EmailPurpose }) {
  return (
    <div className="email-placeholder-help">
      <p>Type these in any text; they are filled in when the email is sent.</p>
      <dl>
        {Object.entries(placeholdersFor(purpose)).map(([name, description]) => (
          <div key={name}>
            <dt>
              <code>{`{{${name}}}`}</code>
            </dt>
            <dd>{description}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function emailBuilderConfig(purpose: EmailPurpose): Config {
  const rootFields: Fields = {
    subject: { type: 'text', label: 'Subject' },
    preheader: { type: 'text', label: 'Preview text (shown after the subject in most inboxes)' },
    showLogo: {
      type: 'radio',
      label: 'Logo at the top (from Site settings; the site’s name when there is none)',
      options: [
        { label: 'Show', value: true },
        { label: 'Hide', value: false },
      ],
    },
    logoSize: {
      type: 'radio',
      label: 'Logo size',
      options: [
        { label: 'Small', value: 'small' },
        { label: 'Medium', value: 'medium' },
        { label: 'Large', value: 'large' },
      ],
    },
    logoAlign: { ...align, label: 'Logo alignment' },
    logoLink: {
      type: 'radio',
      label: 'Logo links to the site',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    showSiteName: {
      type: 'radio',
      label: 'Site’s name with the logo',
      options: [
        { label: 'Show', value: true },
        { label: 'Hide', value: false },
      ],
    },
    logoLayout: {
      type: 'select',
      label: 'Name and logo layout (when the name is shown)',
      options: [
        { label: 'Horizontal: logo, then name', value: 'horizontal' },
        { label: 'Horizontal reversed: name, then logo', value: 'horizontal-reverse' },
        { label: 'Vertical: logo above name', value: 'vertical' },
        { label: 'Vertical reversed: name above logo', value: 'vertical-reverse' },
      ],
    },
    footer: { type: 'textarea', label: 'Footer' },
    placeholders: { type: 'custom', label: 'Placeholders', render: () => <PlaceholderHelp purpose={purpose} /> },
  }

  const components: Config['components'] = {
    Heading: {
      label: 'Heading',
      fields: {
        text: { type: 'text', label: 'Text' },
        level: {
          type: 'radio',
          label: 'Size',
          options: [
            { label: 'Large', value: 'h1' },
            { label: 'Medium', value: 'h2' },
          ],
        },
        align,
      },
      defaultProps: { text: 'Heading', level: 'h2', align: 'left' },
      render: ({ puck, ...props }) => draw('Heading', props, puck.metadata),
    },
    Text: {
      label: 'Text',
      fields: {
        text: { type: 'textarea', label: 'Text (a blank line starts a new paragraph)' },
        size: {
          type: 'radio',
          label: 'Size',
          options: [
            { label: 'Normal', value: 'normal' },
            { label: 'Small', value: 'small' },
          ],
        },
        align,
      },
      defaultProps: { text: 'Write your message here.', size: 'normal', align: 'left' },
      render: ({ puck, ...props }) => draw('Text', props, puck.metadata),
    },
    Button: {
      label: 'Button',
      fields: {
        label: { type: 'text', label: 'Text' },
        url: { type: 'text', label: `Link: https://…, /a-page or {{siteUrl}}${linkPlaceholdersFor(purpose).map((name) => `, or {{${name}}}`).join('')}` },
        style: {
          type: 'radio',
          label: 'Style',
          options: [
            { label: 'Solid', value: 'solid' },
            { label: 'Outline', value: 'outline' },
          ],
        },
        align,
      },
      defaultProps: { label: 'Visit the site', url: '{{siteUrl}}', style: 'solid', align: 'left' },
      render: ({ puck, ...props }) => draw('Button', props, puck.metadata),
    },
    Image: {
      label: 'Image',
      fields: {
        image: {
          type: 'custom',
          label: 'Image',
          render: ({ value, onChange, readOnly }: { value: MediaValue; onChange: (value: MediaValue) => void; readOnly?: boolean }) => (
            <MediaPicker value={value} onChange={onChange} readOnly={readOnly} />
          ),
        },
        alt: { type: 'text', label: 'Description for people who cannot see images (blank: the image’s own)' },
        width: {
          type: 'radio',
          label: 'Width',
          options: [
            { label: 'Full', value: 'full' },
            { label: 'Half', value: 'half' },
          ],
        },
        link: { type: 'text', label: 'Link (optional)' },
        align,
      },
      defaultProps: { image: null, alt: '', width: 'full', link: '', align: 'center' },
      render: ({ puck, ...props }) => draw('Image', props, puck.metadata),
    },
    Divider: { label: 'Divider', fields: {}, render: ({ puck, ...props }) => draw('Divider', props, puck.metadata) },
    Spacer: {
      label: 'Space',
      fields: {
        size: {
          type: 'radio',
          label: 'Size',
          options: [
            { label: 'Small', value: 'small' },
            { label: 'Medium', value: 'medium' },
            { label: 'Large', value: 'large' },
          ],
        },
      },
      defaultProps: { size: 'medium' },
      render: ({ puck, ...props }) => draw('Spacer', props, puck.metadata),
    },
    Columns: {
      label: 'Two columns',
      // Columns stack on phones in the email; they cannot hold more columns.
      fields: { left: { type: 'slot', label: 'Left', disallow: ['Columns'] }, right: { type: 'slot', label: 'Right', disallow: ['Columns'] } },
      defaultProps: { left: [], right: [] },
      // The same table as columnsHtml, with Puck's drop areas in its cells.
      render: ({ left: Left, right: Right }) => (
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ marginBottom: 8 }}>
          <tbody>
            <tr>
              <td width="50%" valign="top" style={{ paddingRight: 12 }}>
                <Left minEmptyHeight={64} />
              </td>
              <td width="50%" valign="top" style={{ paddingLeft: 12 }}>
                <Right minEmptyHeight={64} />
              </td>
            </tr>
          </tbody>
        </table>
      ),
    },
  }
  if (PURPOSE_INFO[purpose].details) {
    components.Details = {
      label: 'Details',
      fields: { title: { type: 'text', label: 'Title above the details (optional)' } },
      defaultProps: { title: '' },
      render: ({ puck, ...props }) => draw('Details', props, puck.metadata),
    }
  }

  return {
    categories: {
      text: { title: 'Text', components: ['Heading', 'Text', 'Button'] },
      layout: { title: 'Images and layout', components: ['Image', 'Columns', 'Divider', 'Spacer'] },
      ...(PURPOSE_INFO[purpose].details ? { details: { title: 'Details', components: ['Details'] } } : {}),
    },
    root: {
      fields: rootFields,
      defaultProps: { subject: '', preheader: '', ...LOGO_DEFAULTS, footer: '' },
      render: ({ children, puck, ...props }: { children: React.ReactNode; puck: { metadata: unknown }; [key: string]: unknown }) => {
        const { ctx } = puck.metadata as EmailBuilderMetadata
        const root = props as unknown as TemplateRoot
        const preview = { ...ctx, showPlaceholders: true }
        const t = ctx.theme
        const logo = logoHtml(root, preview)
        const footer = root.footer ? footerHtml(root, preview) : ''
        // The layout the email uses (layoutHtml), drawn with React so the blocks stay editable.
        return (
          <div className="email-canvas" style={{ background: t.background, padding: '24px 12px', minHeight: '100%' }}>
            <div style={{ maxWidth: 600, margin: '0 auto', background: t.surface, borderRadius: t.radius, border: `1px solid ${t.line}`, fontFamily: t.font, color: t.ink }}>
              {logo ? <div style={{ textAlign: root.logoAlign ?? 'center', padding: '28px 32px 0' }} dangerouslySetInnerHTML={{ __html: logo }} /> : null}
              <div style={{ padding: '28px 32px 12px' }}>{children}</div>
              {footer ? <div style={{ padding: '0 32px 28px' }} dangerouslySetInnerHTML={{ __html: footer }} /> : null}
            </div>
          </div>
        )
      },
    },
    components,
  }
}
