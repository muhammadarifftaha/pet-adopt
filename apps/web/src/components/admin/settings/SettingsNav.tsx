import Link from 'next/link'

import { cn } from '@/lib/utils'

// The switch between the settings screens (site settings, email). Plain links with aria-current,
// so each screen keeps its own form and address.
const ITEMS = [
  { href: '/admin/settings', label: 'Site' },
  { href: '/admin/settings/email', label: 'Email' },
] as const

export function SettingsNav({ current }: { current: (typeof ITEMS)[number]['href'] }) {
  return (
    <nav aria-label="Settings" className="mb-6">
      <ul className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {ITEMS.map((item) => {
          const active = item.href === current
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex rounded-md px-3 py-1.5 text-sm font-medium outline-ring focus-visible:outline-2',
                  active ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
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
