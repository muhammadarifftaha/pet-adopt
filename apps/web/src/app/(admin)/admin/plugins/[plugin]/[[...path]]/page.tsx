import { accessOf, accessPermission, can } from '@pet-adopt/plugin-sdk'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { PageHeader } from '@/components/admin/PageHeader'
import { PluginNotReady } from '@/components/admin/plugins/PluginNotReady'
import { PluginOverview } from '@/components/admin/plugins/PluginOverview'
import { findPluginScreen, getPluginInfo } from '@/plugins/registry'
import { getPluginStorageStatusFor } from '@/plugins/storage'
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

  // A plugin with tables of its own that `pnpm migrate` has not set up yet: say so instead of
  // rendering a screen that would fail on a missing table.
  const storage = await getPluginStorageStatusFor(plugin)
  const notReady = storage && !storage.ready ? <PluginNotReady status={storage} user={user} /> : null

  if (overview) {
    if (!can(user.role, 'plugins:view')) redirect('/admin')
    return (
      <>
        <PageHeader title={overview.title} />
        {notReady ? <div className="mb-6">{notReady}</div> : null}
        <PluginOverview info={overview} user={user} />
      </>
    )
  }

  // The menu hides screens a role cannot open, but the URL still works, so check here too.
  if (!can(user.role, accessPermission(accessOf(match!.screen), 'view'))) redirect('/admin')
  const Screen = match!.screen.component
  return (
    <>
      <PageHeader title={match!.screen.title} />
      {notReady ?? <Screen user={user} params={match!.params} searchParams={await searchParams} />}
    </>
  )
}
