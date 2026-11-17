import Link from 'next/link'

import { EmptyState } from '@/components/admin/EmptyState'
import { PageHeader } from '@/components/admin/PageHeader'
import { StatusBadge } from '@/components/admin/StatusBadge'
import { buttonVariants } from '@/components/ui/button'
import { unwrap } from '@/lib/admin/unwrap'
import { listPetsAction } from '@/server/actions/pets'

export const metadata = { title: 'Pets' }

type SearchParams = Promise<{ search?: string; status?: string; species?: string; page?: string }>

// The filters live in the URL (?search=&status=&species=&page=), so the list can be linked to and
// the back button works. The server component reads them; a GET <form> in the filter bar sets them.
export default async function PetsPage({ searchParams }: { searchParams: SearchParams }) {
  const { search, status, species, page } = await searchParams
  const result = unwrap(await listPetsAction({ search, status, species, page: Number(page) || 1 }))

  return (
    <>
      <PageHeader
        title="Pets"
        description={`${result.totalDocs} in total`}
        actions={
          <Link href="/admin/pets/new" className={buttonVariants()}>
            Add pet
          </Link>
        }
      />

      {/* TODO(ui): filter bar (search input, status and species selects from src/lib/options.ts). */}

      {result.docs.length === 0 ? (
        <EmptyState title="No pets found">Try different filters, or add a pet.</EmptyState>
      ) : (
        // TODO(ui): replace with a proper table: cover thumbnail (photos[0]?.thumbnailUrl), name,
        // species, StatusBadge, flags (featured / unlisted / urgent), location, updated,
        // and row actions (edit, view /pets/{slug}, delete with a confirm dialog -> deletePetAction).
        <ul className="divide-y rounded-lg border">
          {result.docs.map((pet) => (
            <li key={pet.id} className="flex items-center justify-between gap-3 p-3">
              <Link href={`/admin/pets/${pet.id}`} className="font-medium hover:underline">
                {pet.name}
              </Link>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                {pet.species}
                <StatusBadge status={pet.status} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* TODO(ui): pagination using result.page, result.totalPages, hasPrevPage, hasNextPage. */}
    </>
  )
}
