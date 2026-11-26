import Link from 'next/link'
import { FiMail, FiPackage } from 'react-icons/fi'

import { EmptyState } from '@/components/admin/EmptyState'
import { PageHeader } from '@/components/admin/PageHeader'
import { Badge } from '@pet-adopt/ui/components/badge'
import { Card, CardDescription, CardHeader, CardTitle } from '@pet-adopt/ui/components/card'
import { requirePermissionPage } from '@/lib/admin/unwrap'
import { getEmailPlugin, getPluginInfos } from '@/plugins/registry'
import { getPluginStorageStatus } from '@/plugins/storage'

export const metadata = { title: 'Plugins' }

// Every plugin registered in pet-adopt.config.ts, each linking to its page (its own home screen,
// or the built-in overview). Admins only, like the overview pages.
export default async function PluginsPage() {
  await requirePermissionPage('plugins:view')
  const plugins = getPluginInfos()
  const emailStatus = getEmailPlugin()?.sender.status?.() ?? null
  const notReady = new Set((await getPluginStorageStatus()).filter((s) => !s.ready).map((s) => s.plugin))

  return (
    <>
      <PageHeader title="Plugins" description="Extra features added in pet-adopt.config.ts. Each one has its own page." />
      {plugins.length === 0 ? (
        <EmptyState title="No plugins">Add plugins in pet-adopt.config.ts to see them here.</EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {plugins.map((plugin) => {
            const parts = [
              plugin.screens.length ? `${plugin.screens.length} ${plugin.screens.length === 1 ? 'screen' : 'screens'}` : null,
              plugin.widgets.length ? `${plugin.widgets.length} dashboard ${plugin.widgets.length === 1 ? 'card' : 'cards'}` : null,
              plugin.email ? 'email' : null,
            ].filter(Boolean)
            return (
              <li key={plugin.name}>
                <Card className="relative h-full transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ring">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="flex items-center gap-2">
                        {plugin.email ? <FiMail aria-hidden /> : <FiPackage aria-hidden />}
                        {/* The whole card is the link (the ::after covers it); the title is its name. */}
                        <Link href={plugin.href} className="outline-none after:absolute after:inset-0">
                          {plugin.title}
                        </Link>
                      </CardTitle>
                      {notReady.has(plugin.name) ? <Badge variant="destructive">Needs migrate</Badge> : null}
                      {plugin.email && emailStatus ? (
                        <Badge variant={emailStatus.ready ? 'default' : 'destructive'}>{emailStatus.ready ? 'Ready' : 'Not set up'}</Badge>
                      ) : null}
                    </div>
                    {plugin.description ? <CardDescription>{plugin.description}</CardDescription> : null}
                    <p className="text-xs text-muted-foreground">{parts.length ? `Adds ${parts.join(', ')}` : 'Adds nothing visible'}</p>
                  </CardHeader>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
