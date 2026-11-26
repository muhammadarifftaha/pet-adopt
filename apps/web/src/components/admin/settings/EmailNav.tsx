import Link from 'next/link'

import { cn } from '@/lib/utils'

// The Email page's two screens: Sending (the SMTP settings and a test email) and Templates. Plain
// links with aria-current, so each screen keeps its own form and address.
const ITEMS = [
  { href: '/admin/email', label: 'Sending' },
  { href: '/admin/email/templates', label: 'Templates' },
] as const

export function EmailNav({ current }: { current: (typeof ITEMS)[number]['href'] }) {
  return (
    <nav aria-label="Email" className="mb-6">
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
