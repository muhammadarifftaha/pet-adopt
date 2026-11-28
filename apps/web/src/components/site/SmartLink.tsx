import Link from 'next/link'
import React from 'react'

import { isExternal, safeHref } from '@/lib/links'

export function SmartLink({
  href,
  className,
  children,
}: {
  href?: string | null
  className?: string
  children: React.ReactNode
}) {
  const safe = safeHref(href)
  // Mail and phone links hand off to an app: a new tab would only leave a blank one behind.
  if (safe.startsWith('mailto:') || safe.startsWith('tel:')) {
    return (
      <a className={className} href={safe}>
        {children}
      </a>
    )
  }
  if (isExternal(safe)) {
    return (
      <a className={className} href={safe} target="_blank" rel="noopener noreferrer">
        {children}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    )
  }
  return (
    <Link className={className} href={safe}>
      {children}
    </Link>
  )
}
