import { PageHeader } from '@/components/admin/PageHeader'

import { PetForm } from '../PetForm'

export const metadata = { title: 'Add pet' }

export default function NewPetPage() {
  return (
    <>
      <PageHeader title="Add pet" />
      <PetForm pet={null} />
    </>
  )
}
