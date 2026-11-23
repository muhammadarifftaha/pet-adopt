import Link from 'next/link'

import { PageHeader } from '@/components/admin/PageHeader'
import { PluginWidgets } from '@/components/admin/PluginWidgets'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { unwrap } from '@/lib/admin/unwrap'
import { PetStatus } from '@/lib/options'
import { listMediaAction } from '@/server/actions/media'
import { listPagesAction } from '@/server/actions/pages'
import { listPetsAction } from '@/server/actions/pets'

export const metadata = { title: 'Dashboard' }

// Counts come from the list actions (there is no dedicated stats action): `limit: 1` keeps them cheap
// and `totalDocs` is the number that matches.
export default async function DashboardPage() {
  const [available, pending, adopted, pages, media] = await Promise.all([
    listPetsAction({ status: PetStatus.Available, limit: 1 }),
    listPetsAction({ status: PetStatus.Pending, limit: 1 }),
    listPetsAction({ status: PetStatus.Adopted, limit: 1 }),
    listPagesAction(),
    listMediaAction({ limit: 1 }),
  ])

  const stats = [
    { label: 'Available pets', value: unwrap(available).totalDocs },
    { label: 'Pending pets', value: unwrap(pending).totalDocs },
    { label: 'Adopted pets', value: unwrap(adopted).totalDocs },
    { label: 'Pages', value: unwrap(pages).length },
    { label: 'Images', value: unwrap(media).totalDocs },
  ]

  return (
    <>
      <PageHeader
        title="Dashboard"
        actions={
          <>
            <Link href="/admin/pets/new" className={buttonVariants()}>
              Add pet
            </Link>
            <Link href="/admin/pages/new" className={buttonVariants({ variant: 'outline' })}>
              New page
            </Link>
          </>
        }
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map(({ label, value }) => (
          <li key={label}>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">{label}</CardTitle>
              </CardHeader>
              <CardContent className="text-3xl font-semibold">{value}</CardContent>
            </Card>
          </li>
        ))}
      </ul>
      <PluginWidgets />
    </>
  )
}
