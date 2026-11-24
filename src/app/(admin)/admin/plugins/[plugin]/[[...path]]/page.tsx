import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { PageHeader } from '@/components/admin/PageHeader'
import { PluginOverview } from '@/components/admin/plugins/PluginOverview'
import { findPluginScreen, getPluginInfo } from '@/plugins/registry'
import { getSessionUser } from '@/server/session'

type Props = {
  params: Promise<{ plugin: string; path?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// Next cannot add routes while it runs, so every plugin screen is served by this one catch-all route.
// `findPluginScreen` matches the URL against the screens declared in `pet-adopt.config.ts`. Every
// plugin has a page: a plugin without a home screen of its own (`path: ''`) gets the built-in
// overview at /admin/plugins/<name> (admins only, as it shows how the plugin is set up).

/** The built-in overview applies at a plugin's root when the plugin declares no home screen. */
function overviewFor(plugin: string, path: string[]) {
  if (path.length) return null
  const info = getPluginInfo(plugin)
  return info && !info.hasOwnHome ? info : null
}

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const { plugin, path = [] } = await params
  const match = findPluginScreen(plugin, path)
  return { title: match?.screen.title ?? overviewFor(plugin, path)?.title ?? 'Not found' }
}

export default async function PluginScreenPage({ params, searchParams }: Props) {
  const { plugin, path = [] } = await params
  const match = findPluginScreen(plugin, path)
  const overview = match ? null : overviewFor(plugin, path)
  if (!match && !overview) notFound()

  const user = await getSessionUser()
  if (!user) redirect('/admin/login')

  if (overview) {
    if (user.role !== 'admin') redirect('/admin')
    return (
      <>
        <PageHeader title={overview.title} />
        <PluginOverview info={overview} user={user} />
      </>
    )
  }

  // The menu hides admin-only screens, but the URL still works, so check here too.
  if (match!.screen.adminOnly && user.role !== 'admin') redirect('/admin')
  const Screen = match!.screen.component
  return (
    <>
      <PageHeader title={match!.screen.title} />
      <Screen user={user} params={match!.params} searchParams={await searchParams} />
    </>
  )
}
