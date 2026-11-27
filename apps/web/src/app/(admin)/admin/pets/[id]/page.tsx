import { can } from '@pet-adopt/plugin-sdk'
import { PageHeader } from '@/components/admin/PageHeader'
import { ViewOnly, ViewOnlyNotice } from '@/components/admin/view-only'
import { parseId, requirePermissionPage, unwrapOrNotFound } from '@/lib/admin/unwrap'
import { getPetAction } from '@/server/actions/pets'
import { siteCountryCode } from '@/lib/places'
import { getSettings } from '@/server/settings'

import { PetForm } from '../PetForm'

export const metadata = { title: 'Edit pet' }

export default async function EditPetPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionPage('pets:view')
  const { id } = await params
  const pet = unwrapOrNotFound(await getPetAction(parseId(id)))
  const settings = await getSettings()
  const { siteName } = settings

  return (
    <>
      <PageHeader title={pet.name} description={`/pets/${pet.slug}`} />
      <ViewOnly value={!can(user.role, 'pets:edit')}>
        <ViewOnlyNotice role={user.role} what="this pet" />
        <PetForm pet={pet} siteName={siteName} siteCountry={siteCountryCode(settings)} />
      </ViewOnly>
    </>
  )
}
