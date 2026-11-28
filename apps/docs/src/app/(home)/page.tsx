import type { Metadata } from 'next'
import Link from 'next/link'
import { Code, LayoutDashboard } from 'lucide-react'

import { repoUrl } from '@/lib/shared'

export const metadata: Metadata = { alternates: { canonical: '/' } }

const SECTIONS = [
  {
    href: '/docs/admin',
    title: 'For admins',
    text: 'For the team that runs a site day to day.',
    Icon: LayoutDashboard,
    links: [
      { href: '/docs/admin/admin-tour', label: 'A tour of the admin' },
      { href: '/docs/admin/pets', label: 'Pets' },
      { href: '/docs/admin/pages', label: 'Pages and the page builder' },
      { href: '/docs/admin/forms', label: 'Forms' },
      { href: '/docs/admin/users-and-roles', label: 'Users and roles' },
    ],
  },
  {
    href: '/docs/developers',
    title: 'For developers',
    text: 'For whoever installs, hosts and extends a site.',
    Icon: Code,
    links: [
      { href: '/docs/developers/getting-started', label: 'Get started' },
      { href: '/docs/developers/deployment', label: 'Deploy' },
      { href: '/docs/developers/plugins', label: 'Write a plugin' },
      { href: '/docs/developers/contributing', label: 'Contributing' },
    ],
  },
] as const

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring'

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-4 py-16 sm:py-24">
      <section className="flex flex-col items-start gap-5">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Pet Adopt</h1>
        <p className="max-w-2xl text-lg text-fd-muted-foreground">
          An open-source storefront for adoptable pets. Visitors browse the pets and contact you on
          WhatsApp or social media; your team adds pets and builds pages with a drag-and-drop editor.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/docs"
            className={`rounded-lg bg-fd-primary px-4 py-2.5 font-medium text-fd-primary-foreground transition-opacity hover:opacity-90 ${focusRing}`}
          >
            Read the docs
          </Link>
          <a href={repoUrl} className={`rounded-lg border px-4 py-2.5 font-medium transition-colors hover:bg-fd-accent ${focusRing}`}>
            View on GitHub
          </a>
        </div>
      </section>

      <section aria-labelledby="sections-heading">
        <h2 id="sections-heading" className="sr-only">
          Sections
        </h2>
        <ul className="grid gap-4 md:grid-cols-2">
          {SECTIONS.map(({ href, title, text, Icon, links }) => (
            <li key={href} className="flex flex-col gap-4 rounded-xl border bg-fd-card p-6">
              <div className="flex flex-col gap-2">
                <Icon aria-hidden className="size-6 text-fd-primary" />
                <h3 className="text-xl font-semibold">
                  <Link href={href} className={`rounded-sm hover:underline ${focusRing}`}>
                    {title}
                  </Link>
                </h3>
                <p className="text-sm text-fd-muted-foreground">{text}</p>
              </div>
              <ul className="flex flex-col gap-1 border-t pt-4 text-sm">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={`block rounded-md px-2 py-1.5 transition-colors hover:bg-fd-accent ${focusRing}`}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
