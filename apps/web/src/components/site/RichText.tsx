import Link from 'next/link'
import React from 'react'

import {
  isAllowedHref,
  isExternalHref,
  type RichTextBlock,
  type RichTextDoc,
  type RichTextText,
} from '@/lib/rich-text'

// Renders a rich-text document (src/lib/rich-text.ts) as React elements, never as HTML, so nothing
// an owner types can inject markup. It draws only what the validator allows: paragraphs, bulleted
// and numbered lists, bold, italic, underline and links. A link is checked again here, so a bad
// address in stored data is shown as plain text instead of becoming a clickable link.
// No hooks and no browser code: it runs on the server for visitors.

function renderText(node: RichTextText, key: number) {
  let out: React.ReactNode = node.text
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') out = <strong>{out}</strong>
    else if (mark.type === 'italic') out = <em>{out}</em>
    else if (mark.type === 'underline') out = <u>{out}</u>
  }
  const link = node.marks?.find((mark) => mark.type === 'link')
  if (link && link.type === 'link' && isAllowedHref(link.attrs.href)) {
    const { href } = link.attrs
    out = isExternalHref(href) ? (
      <a href={href} rel="noopener noreferrer">
        {out}
      </a>
    ) : (
      <Link href={href}>{out}</Link>
    )
  }
  return <React.Fragment key={key}>{out}</React.Fragment>
}

function renderBlock(block: RichTextBlock, key: number): React.ReactNode {
  if (block.type === 'paragraph') {
    return <p key={key}>{(block.content ?? []).map(renderText)}</p>
  }
  const List = block.type === 'bulletList' ? 'ul' : 'ol'
  return (
    <List key={key}>
      {block.content.map((item, i) => (
        <li key={i}>{item.content.map(renderBlock)}</li>
      ))}
    </List>
  )
}

export function RichText({ doc, className }: { doc: RichTextDoc | null | undefined; className?: string }) {
  if (!doc || doc.content.length === 0) return null
  return <div className={className}>{doc.content.map(renderBlock)}</div>
}
