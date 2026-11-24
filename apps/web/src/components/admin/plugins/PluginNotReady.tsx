import { FiAlertTriangle } from 'react-icons/fi'

import { Card, CardDescription, CardHeader, CardTitle } from '@pet-adopt/ui/components/card'
import type { PluginStorageStatus } from '@/plugins/storage'
import type { SessionUser } from '@/server/types'

// Shown in place of a plugin's screens while its tables are not set up (a plugin added since the
// last `pnpm migrate` on PostgreSQL, or one whose migration failed). Admins see what to do; editors
// are told to ask one, since they cannot run commands on the server.
export function PluginNotReady({ status, user }: { status: PluginStorageStatus; user: SessionUser }) {
  return (
    <Card className="max-w-3xl border-destructive">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FiAlertTriangle aria-hidden className="text-destructive" />
          {status.title} is not set up yet
        </CardTitle>
        <CardDescription>
          {user.role === 'admin'
            ? status.problem
            : 'This plugin needs a setup step on the server before it can be used. Ask an admin to finish it.'}
        </CardDescription>
      </CardHeader>
    </Card>
  )
}
