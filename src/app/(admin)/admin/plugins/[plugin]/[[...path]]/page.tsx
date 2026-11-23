import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { PageHeader } from '@/components/admin/PageHeader'
import { findPluginScreen } from '@/plugins/registry'
import { getSessionUser } from '@/server/session'

type Props = {
  params: Promise<{ plugin: string; path?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// Next cannot add routes while it runs, so every plugin screen is served by this one catch-all route.
// `findPluginScreen` matches the URL against the screens declared in `pet-adopt.config.ts`.
export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const { plugin, path = [] } = await params
  const match = findPluginScreen(plugin, path)
  return { title: match?.screen.title ?? 'Not found' }
}

export default async function PluginScreenPage({ params, searchParams }: Props) {
  const { plugin, path = [] } = await params
  const match = findPluginScreen(plugin, path)
  if (!match) notFound()

  const user = await getSessionUser()
  if (!user) redirect('/admin/login')
  // The menu hides admin-only screens, but the URL still works, so check here too.
  if (match.screen.adminOnly && user.role !== 'admin') redirect('/admin')

  const Screen = match.screen.component
  return (
    <>
      <PageHeader title={match.screen.title} />
      <Screen user={user} params={match.params} searchParams={await searchParams} />
    </>
  )
}
