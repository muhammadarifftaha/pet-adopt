'use client'

import type { Pet } from '@/server/types'

// TODO(ui): the pet form, used for both create (pet = null) and edit.
//
//  - Tabs: Basics, Health and behaviour, Photos and story, Adoption, SEO; sidebar with status,
//    featured, unlisted, urgent, slug. Field names and limits are in ADMIN_UI.md section 3.
//  - Submit: `savePetAction(pet?.id ?? null, input)` from '@/server/actions/pets'. Send only the
//    fields you have. On ok, router.push(`/admin/pets/${data.id}`); on `fieldErrors`, show each
//    under its input and switch to the tab that holds the first error.
//  - Photos: `photoIds` (1 to 10, the first is the cover) through the media picker dialog.
//  - Select options: SPECIES, STATUSES, SEXES, AGE_GROUPS, SIZES, TEMPERAMENTS, GOOD_WITH in
//    '@/lib/options'.
export function PetForm({ pet }: { pet: Pet | null }) {
  return (
    <p className="text-sm text-muted-foreground">
      {pet ? `Edit form for "${pet.name}" goes here.` : 'The new pet form goes here.'}
    </p>
  )
}
