'use server'

import type { Option } from '@/lib/options'

import { changedFields, quoted, recordActivity } from '../activity'
import { deletePet, getPetById, getSpeciesOptions, queryPets, savePet, type PetFilters } from '../pets'
import { assertId, run, type ActionResult } from '../result'
import { requirePermission } from '../session'
import type { Pet, PetPage } from '../types'

/** Admin list: every pet, including unlisted ones. Supports `search`, `status`, `species`, `page`. */
export async function listPetsAction(filters: PetFilters = {}): Promise<ActionResult<PetPage>> {
  return run(async () => {
    await requirePermission('pets:view')
    return queryPets({ ...filters, includeUnlisted: true })
  })
}

/**
 * Species in use, as `{ label, value }` options for the admin's species filter and form suggestions
 * (built-in ones first, then custom). Includes unlisted pets. The form should still accept any text.
 */
export async function listSpeciesOptionsAction(): Promise<ActionResult<Option[]>> {
  return run(async () => {
    await requirePermission('pets:view')
    return getSpeciesOptions({ includeUnlisted: true })
  })
}

export async function getPetAction(id: number): Promise<ActionResult<Pet | null>> {
  return run(async () => {
    await requirePermission('pets:view')
    return getPetById(assertId(id))
  })
}

/**
 * Creates (`id` = null) or updates a pet. Send only the fields you have; see `savePet` for the
 * field names. Returns `fieldErrors` keyed by field name when something is invalid.
 */
export async function savePetAction(id: number | null, input: unknown): Promise<ActionResult<{ id: number; slug: string }>> {
  return run(async () => {
    const user = await requirePermission('pets:edit')
    const petId = id === null ? null : assertId(id)
    const before = petId === null ? null : await getPetById(petId)
    const saved = await savePet(petId, input)
    const after = await getPetById(saved.id)
    await recordActivity({
      actor: user,
      action: petId === null ? 'pet.create' : 'pet.update',
      area: 'pets',
      summary: `${petId === null ? 'Added' : 'Updated'} the pet ${quoted(after?.name)}`,
      subject: { id: saved.id, label: after?.name },
      fields: changedFields(before, after),
    })
    return saved
  })
}

export async function deletePetAction(id: number): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePermission('pets:edit')
    const petId = assertId(id)
    const before = await getPetById(petId)
    await deletePet(petId)
    await recordActivity({ actor: user, action: 'pet.delete', area: 'pets', summary: `Deleted the pet ${quoted(before?.name)}`, subject: { id: petId, label: before?.name } })
  })
}
