// Fills the folded search columns (pets.search_text, pets.location_search, media.search_text) for
// rows saved before they existed (migration 0011). Folding happens in JavaScript (foldText), so a
// migration cannot do it: this runs on server start and in `pnpm migrate`, and only touches rows
// whose column is still empty. New and edited rows get theirs on save.
import { foldText } from '@pet-adopt/plugin-sdk'
import { eq, isNull } from 'drizzle-orm'

import { getDatabase } from '@/db/client'

import { mediaSearchText } from './media'
import { petSearchText } from './pets'

const BATCH = 200

export async function backfillSearchText(): Promise<{ pets: number; media: number }> {
  const { db, t } = await getDatabase()
  let pets = 0
  let media = 0
  for (;;) {
    const rows = await db
      .select({ id: t.pets.id, name: t.pets.name, breed: t.pets.breed, location: t.pets.location })
      .from(t.pets)
      .where(isNull(t.pets.searchText))
      .limit(BATCH)
    if (!rows.length) break
    for (const row of rows) {
      await db
        .update(t.pets)
        .set({ searchText: petSearchText(row), locationSearch: foldText(row.location) || null })
        .where(eq(t.pets.id, row.id))
      pets++
    }
  }
  for (;;) {
    const rows = await db.select({ id: t.media.id, name: t.media.name, alt: t.media.alt }).from(t.media).where(isNull(t.media.searchText)).limit(BATCH)
    if (!rows.length) break
    for (const row of rows) {
      await db.update(t.media).set({ searchText: mediaSearchText(row) }).where(eq(t.media.id, row.id))
      media++
    }
  }
  return { pets, media }
}
