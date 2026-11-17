import { PageHeader } from '@/components/admin/PageHeader'

import { PageForm } from '../PageForm'

export const metadata = { title: 'New page' }

export default function NewPagePage() {
  return (
    <>
      <PageHeader title="New page" />
      <PageForm page={null} />
    </>
  )
}
