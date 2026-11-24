import type { SearchParams } from 'nuqs/server'

import { MediaLibrary } from '@/components/admin/MediaLibrary'
import { PageHeader } from '@/components/admin/PageHeader'
import { unwrap } from '@/lib/admin/unwrap'
import { listMediaAction } from '@/server/actions/media'

import { loadMediaSearchParams } from './search-params'

export const metadata = { title: 'Media' }

// Like the pets list: the view lives in the URL (?search=&page=&perPage=, see ./search-params.ts).
// This server component only loads the first render, the URL as it was when the page opened and
// the images for it. After that MediaLibrary changes the URL without asking the server and fetches
// and caches the images with SWR.
export default async function MediaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = await loadMediaSearchParams(searchParams)
  const initialData = unwrap(await listMediaAction({ search: filters.search || undefined, page: filters.page, limit: filters.perPage }))

  return (
    <>
      <PageHeader title="Media" description="Every image used on the site: pet photos, page images, the logo and the site icon." />
      <MediaLibrary initialFilters={filters} initialData={initialData} />
    </>
  )
}
