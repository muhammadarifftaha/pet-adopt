import { can } from '@pet-adopt/plugin-sdk'
import { PageHeader } from '@/components/admin/PageHeader'
import { PetTimeline } from '@/components/admin/pets/timeline/PetTimeline'
import { ViewOnly, ViewOnlyNotice } from '@/components/admin/view-only'
import { parseId, requirePermissionPage, unwrapOrNotFound } from '@/lib/admin/unwrap'
import { getPetAction } from '@/server/actions/pets'
import { listPetTimelineAction } from '@/server/actions/pet-timeline'
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
  // The first draw of the Timeline section; it keeps itself up to date after that (SWR).
  const timeline = await listPetTimelineAction(pet.id)

  return (
    <>
      <PageHeader title={pet.name} description={`/pets/${pet.slug}`} />
      <ViewOnly value={!can(user.role, 'pets:edit')}>
        <ViewOnlyNotice role={user.role} what="this pet" />
        <PetForm pet={pet} siteName={siteName} siteCountry={siteCountryCode(settings)} />
        {/* Outside the pet's <form>: updates save on their own, never with the pet. */}
        <PetTimeline petId={pet.id} petName={pet.name} initial={timeline.ok ? timeline.data : []} />
      </ViewOnly>
    </>
  )
}
