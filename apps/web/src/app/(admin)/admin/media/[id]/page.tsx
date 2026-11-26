import Link from 'next/link'
import { FiArrowLeft } from 'react-icons/fi'

import { MediaDetails } from '@/components/admin/MediaDetails'
import { PageHeader } from '@/components/admin/PageHeader'
import { buttonVariants } from '@pet-adopt/ui/components/button'
import { ViewOnly, ViewOnlyNotice } from '@/components/admin/view-only'
import { parseId, requirePermissionPage, unwrapOrNotFound } from '@/lib/admin/unwrap'
import { can } from '@pet-adopt/plugin-sdk'
import { extensionOf } from '@/lib/media-name'
import { getMediaAction } from '@/server/actions/media'

export const metadata = { title: 'Image' }

// One image from the library: the picture, its file details, where it is used, its alt text
// (editable) and delete. A tile in the library grid links here while "Select images" is off.

const sizeLabel = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

export default async function MediaImagePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionPage('media:view')
  const { id } = await params
  const { media, usage } = unwrapOrNotFound(await getMediaAction(parseId(id)))

  const uses = [
    usage.pets ? `${usage.pets} ${usage.pets === 1 ? 'pet' : 'pets'} (photos or share image)` : null,
    usage.pages ? `${usage.pages} ${usage.pages === 1 ? 'page' : 'pages'} (share image)` : null,
    usage.layouts ? `${usage.layouts} page ${usage.layouts === 1 ? 'layout' : 'layouts'}` : null,
    usage.logo ? 'the site logo' : null,
    usage.favicon ? 'the site icon' : null,
  ].filter((use): use is string => use !== null)

  return (
    <>
      <Link href="/admin/media" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-2 mb-2' })}>
        <FiArrowLeft aria-hidden />
        Media library
      </Link>
      <PageHeader title={media.name || media.alt || media.filename} description={media.name ? media.alt : undefined} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]">
        <div className="flex items-start justify-center rounded-lg border bg-muted/40 p-2">
          {/* The original file, at most the screen's height. The text beside it describes it, so
              the alt text here is the image's own. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={media.url} alt={media.alt} className="max-h-[70vh] w-auto max-w-full rounded object-contain" />
        </div>
        <div className="flex flex-col gap-6">
          <section aria-labelledby="media-file-heading">
            <h2 id="media-file-heading" className="mb-2 font-semibold">
              File
            </h2>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Type</dt>
              <dd>{media.mimeType.replace('image/', '').toUpperCase()}</dd>
              <dt className="text-muted-foreground">Size</dt>
              <dd>{sizeLabel(media.size)}</dd>
              {media.width && media.height ? (
                <>
                  <dt className="text-muted-foreground">Dimensions</dt>
                  <dd>
                    {media.width} × {media.height} px
                  </dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Uploaded</dt>
              <dd>{new Date(media.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
            </dl>
          </section>
          <section aria-labelledby="media-usage-heading">
            <h2 id="media-usage-heading" className="mb-2 font-semibold">
              Where it is used
            </h2>
            {uses.length ? (
              <ul className="list-disc pl-5 text-sm">
                {uses.map((use) => (
                  <li key={use}>{use}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Not used anywhere yet.</p>
            )}
          </section>
          <ViewOnly value={!can(user.role, 'media:edit')}>
            <ViewOnlyNotice role={user.role} what="this image" />
            <MediaDetails id={media.id} name={media.name} alt={media.alt} extension={extensionOf(media.filename)} inUse={uses.length > 0} />
          </ViewOnly>
        </div>
      </div>
    </>
  )
}
