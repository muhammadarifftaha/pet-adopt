'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

import { ADMIN_NAV } from './nav-items'

// Same structure as AuthNav (named nav landmark, a list of links, aria-current plus a non-colour cue).
// Nested screens (/admin/pets/3) keep their section marked as current.
export function AdminNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()
  const items = ADMIN_NAV.filter((item) => isAdmin || !item.adminOnly)

  return (
    <nav aria-label="Admin">
      <ul className="flex flex-row gap-1 md:flex-col">
        {items.map(({ href, label }) => {
          const current = href === '/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-2 text-sm hover:bg-muted',
                  current && 'bg-muted font-semibold underline underline-offset-4',
                )}
              >
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
