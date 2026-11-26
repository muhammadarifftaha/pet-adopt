import { can } from '@pet-adopt/plugin-sdk'
import Link from 'next/link'

import { buttonVariants } from '@pet-adopt/ui/components/button'
import { ActivityFilters, type ActivityFilterValues } from '@/components/admin/activity/ActivityFilters'
import { ActivityList, ExportActivityButton } from '@/components/admin/activity/ActivityLog'
import { PageHeader } from '@/components/admin/PageHeader'
import { requirePermissionPage, unwrap } from '@/lib/admin/unwrap'
import { activityRetentionDays } from '@/server/activity'
import { listActivityAction } from '@/server/actions/activity'

export const metadata = { title: 'Activity' }

type Search = Record<string, string | string[] | undefined>
const one = (value: string | string[] | undefined) => (typeof value === 'string' && value ? value : null)

// Who did what, and when (src/server/activity.ts). Everyone sees their own entries; admins and
// audit see everyone's and can download them. Filters live in the URL; the actions check them.
export default async function ActivityPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requirePermissionPage('activity:own')
  const search = await searchParams
  const filters: ActivityFilterValues = { area: one(search.area), actor: one(search.actor), from: one(search.from), to: one(search.to) }
  const page = Math.max(Math.floor(Number(one(search.page)) || 1), 1)
  const data = unwrap(await listActivityAction({ ...filters, page }))
  const all = data.scope === 'all'
  const days = activityRetentionDays()
  const kept = days % 365 === 0 ? `${days / 365} year${days === 365 ? '' : 's'}` : `${days} days`

  const pageHref = (target: number) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
    if (target > 1) params.set('page', String(target))
    return params.size ? `/admin/activity?${params}` : '/admin/activity'
  }

  return (
    <>
      <PageHeader
        title="Activity"
        description={
          all
            ? `Who changed what, and when, for everyone. Entries are kept for ${kept}.`
            : `What you have changed, your sign-ins, and failed sign-ins to your account. Entries are kept for ${kept}.`
        }
        actions={can(me.role, 'activity:export') ? <ExportActivityButton filters={filters} disabled={data.total === 0} /> : null}
      />
      <div className="flex flex-col gap-4">
        <ActivityFilters values={filters} actors={data.actors} />
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {data.total} {data.total === 1 ? 'entry' : 'entries'}
          {data.pages > 1 ? `, page ${data.page} of ${data.pages}` : ''}
        </p>
        <ActivityList rows={data.entries} meId={me.id} showClient={all} />
        {data.pages > 1 ? (
          <nav aria-label="Pages" className="flex items-center justify-between gap-2">
            {data.page > 1 ? (
              <Link className={buttonVariants({ variant: 'outline' })} href={pageHref(data.page - 1)}>
                Newer
              </Link>
            ) : (
              <span />
            )}
            {data.page < data.pages ? (
              <Link className={buttonVariants({ variant: 'outline' })} href={pageHref(data.page + 1)}>
                Older
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </>
  )
}
