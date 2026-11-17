'use server'

import { deletePet, getPetById, queryPets, savePet, type PetFilters } from '../pets'
import { assertId, run, type ActionResult } from '../result'
import { requireUser } from '../session'
import type { Pet, PetPage } from '../types'

/** Admin list: every pet, including unlisted ones. Supports `search`, `status`, `species`, `page`. */
export async function listPetsAction(filters: PetFilters = {}): Promise<ActionResult<PetPage>> {
  return run(async () => {
    await requireUser()
    return queryPets({ ...filters, includeUnlisted: true })
  })
}

export async function getPetAction(id: number): Promise<ActionResult<Pet | null>> {
  return run(async () => {
    await requireUser()
    return getPetById(assertId(id))
  })
}

/**
 * Creates (`id` = null) or updates a pet. Send only the fields you have; see `savePet` for the
 * field names. Returns `fieldErrors` keyed by field name when something is invalid.
 */
export async function savePetAction(id: number | null, input: unknown): Promise<ActionResult<{ id: number; slug: string }>> {
  return run(async () => {
    await requireUser()
    return savePet(id === null ? null : assertId(id), input)
  })
}

export async function deletePetAction(id: number): Promise<ActionResult> {
  return run(async () => {
    await requireUser()
    await deletePet(assertId(id))
  })
}
