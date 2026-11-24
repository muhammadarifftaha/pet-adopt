import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getPluginWidgets } from '@/plugins/registry'
import { getSessionUser } from '@/server/session'

// Dashboard cards contributed by plugins (`dashboardWidgets` in a plugin). Renders nothing when no
// plugin adds one, so the dashboard looks the same until a plugin is registered.
export async function PluginWidgets() {
  const user = await getSessionUser()
  if (!user) return null

  const widgets = getPluginWidgets().filter((w) => !w.adminOnly || user.role === 'admin')
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
