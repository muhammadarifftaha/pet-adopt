import { EmptyState } from '@/components/admin/EmptyState'
import { PageHeader } from '@/components/admin/PageHeader'
import { unwrap } from '@/lib/admin/unwrap'
import { listMediaAction } from '@/server/actions/media'

export const metadata = { title: 'Media' }

type SearchParams = Promise<{ search?: string; page?: string }>

export default async function MediaPage({ searchParams }: { searchParams: SearchParams }) {
  const { search, page } = await searchParams
  const result = unwrap(await listMediaAction({ search, page: Number(page) || 1 }))

  return (
    <>
      <PageHeader title="Media" description={`${result.totalDocs} images`} />

      {/* TODO(ui): upload area (drag and drop plus file picker) -> uploadMediaAction(formData) with
          fields `file` and `alt`; show fieldErrors.file and fieldErrors.alt. JPEG, PNG, WebP or GIF,
          up to 10 MB (AVIF and HEIC are refused). */}

      {result.docs.length === 0 ? (
        <EmptyState title="No images yet">Upload a photo to get started.</EmptyState>
      ) : (
        // TODO(ui): thumbnail grid; each opens a detail view (getMediaAction(id) returns `usage`)
        // with edit alt text (updateMediaAltAction) and delete (deleteMediaAction).
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {result.docs.map((item) => (
            <li key={item.id} className="overflow-hidden rounded-lg border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.thumbnailUrl} alt={item.alt} className="aspect-square w-full object-cover" />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
