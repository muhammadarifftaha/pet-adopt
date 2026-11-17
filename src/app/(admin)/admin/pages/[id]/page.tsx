import Link from 'next/link'

import { PageHeader } from '@/components/admin/PageHeader'
import { buttonVariants } from '@/components/ui/button'
import { parseId, unwrapOrNotFound } from '@/lib/admin/unwrap'
import { getPageAction } from '@/server/actions/pages'

import { PageForm } from '../PageForm'

export const metadata = { title: 'Page settings' }

// The page builder's "Page settings" link lands here.
export default async function PageSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const page = unwrapOrNotFound(await getPageAction(parseId(id)))

  return (
    <>
      <PageHeader
        title={page.title}
        actions={
          <Link href={`/edit/${page.id}`} className={buttonVariants()}>
            Open page builder
          </Link>
        }
      />
      <PageForm page={page} />
    </>
  )
}
