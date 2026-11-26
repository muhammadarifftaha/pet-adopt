import { accessOf, accessPermission, can } from '@pet-adopt/plugin-sdk'
import { Card, CardContent, CardHeader, CardTitle } from '@pet-adopt/ui/components/card'
import { getPluginWidgets } from '@/plugins/registry'
import { getPluginStorageStatus } from '@/plugins/storage'
import { getSessionUser } from '@/server/session'

// Dashboard cards contributed by plugins (`dashboardWidgets` in a plugin). Renders nothing when no
// plugin adds one, so the dashboard looks the same until a plugin is registered.
export async function PluginWidgets() {
  const user = await getSessionUser()
  if (!user) return null

  // Cards of a plugin whose tables are not set up yet would fail; its screens say why instead.
  const notReady = new Set(
    await getPluginStorageStatus().then(
      (statuses) => statuses.filter((s) => !s.ready).map((s) => s.plugin),
      () => getPluginWidgets().map((w) => w.plugin), // cannot tell: leave plugin cards out rather than break the dashboard
    ),
  )
  const widgets = getPluginWidgets().filter((w) => can(user.role, accessPermission(accessOf(w), 'view')) && !notReady.has(w.plugin))
  if (widgets.length === 0) return null

  return (
    <section aria-label="Plugins" className="mt-6">
      <ul className="grid gap-4 md:grid-cols-2">
        {widgets.map(({ plugin, id, title, component: Widget }) => (
          <li key={`${plugin}/${id}`}>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <Widget user={user} />
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  )
}
