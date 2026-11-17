import { PageHeader } from '@/components/admin/PageHeader'
import { parseId, unwrapOrNotFound } from '@/lib/admin/unwrap'
import { getPetAction } from '@/server/actions/pets'

import { PetForm } from '../PetForm'

export const metadata = { title: 'Edit pet' }

export default async function EditPetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const pet = unwrapOrNotFound(await getPetAction(parseId(id)))

  return (
    <>
      <PageHeader title={pet.name} description={`/pets/${pet.slug}`} />
      <PetForm pet={pet} />
    </>
  )
}
