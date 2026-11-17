import Link from 'next/link'
import React from 'react'

import type { SessionUser } from '@/server/types'

import { AdminNav } from './AdminNav'
import { UserMenu } from './UserMenu'

// The frame around every admin screen: skip link, header, navigation and <main>.
// TODO(ui): toaster (shadcn `sonner`) goes here once it is added; sidebar collapse on mobile.
export function AdminShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[14rem_1fr]">
      {/* First focusable element: lets keyboard users skip the navigation (WCAG 2.4.1). */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to main content
      </a>

      <aside className="border-b p-3 md:border-r md:border-b-0">
        <Link href="/admin" className="mb-3 block px-3 py-2 font-semibold">
          Pet Adopt admin
        </Link>
        <AdminNav isAdmin={user.role === 'admin'} />
        <Link href="/" className="mt-3 block px-3 py-2 text-sm text-muted-foreground hover:underline">
          View site
        </Link>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex justify-end border-b p-3">
          <UserMenu user={user} />
        </header>
        <main id="main-content" tabIndex={-1} className="flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
