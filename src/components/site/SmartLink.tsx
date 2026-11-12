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
  if (isExternal(safe) || safe.startsWith('mailto:') || safe.startsWith('tel:')) {
    return (
      <a className={className} href={safe} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  }
  return (
    <Link className={className} href={safe}>
      {children}
    </Link>
  )
}
