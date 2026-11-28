'use server'

// A pet's timeline (src/server/pet-timeline.ts): viewing needs pets:view, every change pets:edit and
// is logged with the pet as the subject (field names only, never the text).
import type { TimelineEntry } from '@/lib/pet-timeline'

import { changedFields, quoted, recordActivity } from '../activity'
import { addTimelineEntry, deleteTimelineEntry, getTimelineEntry, listTimeline, timelinePet, updateTimelineEntry } from '../pet-timeline'
import { assertId, run, UserError, type ActionResult } from '../result'
import { requirePermission } from '../session'

/** Fields compared for the log: what a person edits, not what is worked out from it. */
const DERIVED = ['id', 'petId', 'photos', 'createdByName']

/** Every entry of a pet, newest first. */
export async function listPetTimelineAction(petId: number): Promise<ActionResult<TimelineEntry[]>> {
  return run(async () => {
    await requirePermission('pets:view')
    return listTimeline(assertId(petId))
  })
}

/** Adds an entry (field keys: date, time, title, body, photoIds). */
export async function addPetTimelineEntryAction(petId: number, input: unknown): Promise<ActionResult<TimelineEntry>> {
  return run(async () => {
    const user = await requirePermission('pets:edit')
    const id = assertId(petId)
    const entry = await addTimelineEntry(id, input, user.id)
    const pet = await timelinePet(id)
    await recordActivity({
      actor: user,
      action: 'pet.timeline-add',
      area: 'pets',
      summary: `Added a timeline entry to the pet ${quoted(pet?.name)}`,
      subject: { id, label: pet?.name },
    })
    return entry
  })
}

/** Changes the fields sent; the others stay. */
export async function updatePetTimelineEntryAction(entryId: number, input: unknown): Promise<ActionResult<TimelineEntry>> {
  return run(async () => {
    const user = await requirePermission('pets:edit')
    const id = assertId(entryId)
    const before = await getTimelineEntry(id)
    if (!before) throw new UserError('Timeline entry not found.')
    const after = await updateTimelineEntry(id, input)
    const pet = await timelinePet(after.petId)
    await recordActivity({
      actor: user,
      action: 'pet.timeline-update',
      area: 'pets',
      summary: `Updated a timeline entry of the pet ${quoted(pet?.name)}`,
      subject: { id: after.petId, label: pet?.name },
      fields: changedFields(before, after, DERIVED),
    })
    return after
  })
}

export async function deletePetTimelineEntryAction(entryId: number): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePermission('pets:edit')
    const { petId } = await deleteTimelineEntry(assertId(entryId))
    const pet = await timelinePet(petId)
    await recordActivity({
      actor: user,
      action: 'pet.timeline-delete',
      area: 'pets',
      summary: `Deleted a timeline entry of the pet ${quoted(pet?.name)}`,
      subject: { id: petId, label: pet?.name },
    })
  })
}
