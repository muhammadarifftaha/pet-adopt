import React from 'react'

import { safeHref } from '@/lib/links'
import { SOCIAL_PLATFORMS, labelFor } from '@/lib/options'

export type SocialLink = { platform: string; url: string }

export function SocialLinks({ items, className }: { items?: SocialLink[] | null; className?: string }) {
  // safeHref turns anything unsafe (javascript:, data:...) into "#", which we then drop.
  const links = (items ?? [])
    .map((s) => ({ ...s, url: safeHref(s.url) }))
    .filter((s) => s.url !== '#')
  if (!links.length) return null
  return (
    <ul className={`social-links${className ? ` ${className}` : ''}`}>
      {links.map((s, i) => (
        <li key={`${s.platform}-${i}`}>
          <a href={s.url} target="_blank" rel="noopener noreferrer">
            {labelFor(SOCIAL_PLATFORMS, s.platform)}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
