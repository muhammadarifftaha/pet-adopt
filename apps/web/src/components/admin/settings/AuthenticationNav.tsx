'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

// The Authentication page's side menu: Two-factor (which roles must use it), Sign-in providers
// (OAuth 2 / OIDC) and Archived accounts.
// Plain links with aria-current (each screen is its own address), drawn like Email's side menu.
const ITEMS = [
  { href: '/admin/authentication', label: 'Two-factor' },
  { href: '/admin/authentication/providers', label: 'Sign-in providers' },
  { href: '/admin/authentication/archived', label: 'Archived accounts' },
] as const

export function AuthenticationNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Authentication sections" className="w-full md:sticky md:top-4 md:w-52 md:shrink-0">
      <ul className="flex flex-col gap-1 rounded-lg border p-1.5">
        {ITEMS.map((item) => {
          const active = pathname === item.href
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex w-full rounded-md px-3 py-2 text-sm font-medium outline-ring focus-visible:outline-2',
                  active ? 'bg-muted text-foreground shadow-sm' : 'text-foreground/60 hover:text-foreground',
                )}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
