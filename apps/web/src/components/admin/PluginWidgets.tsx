import { accessOf, accessPermission, can } from '@pet-adopt/plugin-sdk'
import { Card, CardContent, CardHeader, CardTitle } from '@pet-adopt/ui/components/card'
import { Suspense } from 'react'
import { PluginWidgetBoundary } from '@/components/admin/PluginWidgetBoundary'
import { getPluginWidgets } from '@/plugins/registry'
import { getPluginStorageStatus } from '@/plugins/storage'
import { getSessionUser } from '@/server/session'

// Dashboard cards contributed by plugins (`dashboardWidgets` in a plugin). Renders nothing when no
// plugin adds one, so the dashboard looks the same until a plugin is registered. Each card is on its
// own: a widget that throws (a bug, a database hiccup) shows "could not be loaded" in its card and
// leaves the rest of the dashboard alone, and a slow one does not hold up the page.
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
                {/* Suspense inside the boundary: a failure during the server render then falls
                    back to rendering in the browser, where the boundary catches it. */}
                <PluginWidgetBoundary>
                  <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
                    <Widget user={user} />
                  </Suspense>
                </PluginWidgetBoundary>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  )
}
