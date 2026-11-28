import Link from 'next/link'
import { BookOpen, Puzzle, Rocket, Server } from 'lucide-react'

import { repoUrl } from '@/lib/shared'

const SECTIONS = [
  {
    href: '/docs/getting-started',
    title: 'Get started',
    text: 'Run a site on your own machine, create the first account and add your first pet.',
    Icon: Rocket,
  },
  {
    href: '/docs/guides',
    title: 'Run a site',
    text: 'Pets, pages, forms, email, users and roles: what the admin does and how to use it.',
    Icon: BookOpen,
  },
  {
    href: '/docs/deployment',
    title: 'Deploy',
    text: 'Database, upload storage, the reverse proxy, backups and updates, step by step.',
    Icon: Server,
  },
  {
    href: '/docs/plugins',
    title: 'Write a plugin',
    text: 'Admin screens, dashboard cards, page builder blocks and storage, with the plugin SDK.',
    Icon: Puzzle,
  },
] as const

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
            className="rounded-lg bg-fd-primary px-4 py-2.5 font-medium text-fd-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
          >
            Read the docs
          </Link>
          <a
            href={repoUrl}
            className="rounded-lg border px-4 py-2.5 font-medium transition-colors hover:bg-fd-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
          >
            View on GitHub
          </a>
        </div>
      </section>

      <section aria-labelledby="sections-heading">
        <h2 id="sections-heading" className="sr-only">
          Sections
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {SECTIONS.map(({ href, title, text, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex h-full flex-col gap-2 rounded-xl border bg-fd-card p-5 transition-colors hover:bg-fd-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
              >
                <Icon aria-hidden className="size-5 text-fd-primary" />
                <span className="font-semibold">{title}</span>
                <span className="text-sm text-fd-muted-foreground">{text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
