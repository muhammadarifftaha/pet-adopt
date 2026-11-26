import Link from 'next/link'

import { Card, CardContent, CardHeader, CardTitle } from '@pet-adopt/ui/components/card'
import { fieldLabel } from '@/lib/activity'
import { listRecentActivityAction } from '@/server/actions/activity'

import { Time } from './ActivityLog'

// The dashboard's "Recent activity" card: the newest entries the person may see (everyone's for
// admin and audit, their own otherwise), with a link to the full log. A failure to load hides the
// card instead of breaking the dashboard.
export async function RecentActivity({ limit = 8 }: { limit?: number }) {
  const result = await listRecentActivityAction(limit)
  if (!result.ok) return null
  const { entries, scope } = result.data
  const headingId = 'recent-activity-heading'

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle id={headingId} className="text-sm font-medium">
            {scope === 'all' ? 'Recent activity' : 'Your recent activity'}
          </CardTitle>
          <Link href="/admin/activity" className="text-sm underline underline-offset-4">
            View all activity
          </Link>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ol className="flex flex-col divide-y">
              {entries.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-0.5 py-2 text-sm first:pt-0 last:pb-0">
                  <span>
                    {scope === 'all' ? <span className="font-medium">{entry.actorName ?? 'Nobody signed in'}: </span> : null}
                    {entry.summary}
                  </span>
                  <span className="text-muted-foreground">
                    <Time at={entry.at} />
                    {entry.fields?.length ? ` · Changed: ${entry.fields.map(fieldLabel).join(', ')}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
