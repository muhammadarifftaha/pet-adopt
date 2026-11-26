import { PageHeader } from '@/components/admin/PageHeader'
import { requirePermissionPage } from '@/lib/admin/unwrap'

import { PageForm } from '../PageForm'

export const metadata = { title: 'New page' }

export default async function NewPagePage() {
  await requirePermissionPage('pages:edit')
  return (
    <>
      <PageHeader title="New page" />
      <PageForm page={null} />
    </>
  )
}
