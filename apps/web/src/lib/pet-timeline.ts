// A pet's timeline: dated updates (arrived, vaccinated, moved to a foster home...) shown on the
// pet's page by the Pet timeline block of the Pet page template. Pure: shared by the server rules
// (src/server/pet-timeline.ts), the admin form's zod schema and the block.
//
// Entries are their own rows (table pet_timeline_entries), each added, edited or deleted on its
// own, so posting an update never resaves the pet or the other entries.
import type { RichTextDoc } from './rich-text'

/** Visible characters allowed in one entry's text. */
export const TIMELINE_TEXT_MAX_CHARS = 2000
export const TIMELINE_TITLE_MAX = 120
/** Photos on one entry (from the media library). */
export const TIMELINE_MAX_PHOTOS = 6
/** Entries on one pet. */
export const TIMELINE_MAX_ENTRIES = 200

/** One photo as the page draws it. */
export type TimelinePhoto = { url: string; alt: string; thumbnailUrl?: string | null }

/** One entry, as the admin and the block read it. */
export type TimelineEntry = {
  id: number
  petId: number
  /** The day it happened, YYYY-MM-DD (a calendar day, not an instant). */
  date: string
  /** Optional time of day, HH:MM (24-hour), in the site's time zone; null when only the day is known. */
  time: string | null
  title: string
  /** Rich text (validated by validateRichText); null when there is none. */
  body: RichTextDoc | null
  /** The media library ids, in order. */
  photoIds: number[]
  /** The photos, resolved for drawing; a deleted or missing image is left out. */
  photos: TimelinePhoto[]
  createdAt: string
  updatedAt: string
  createdByName: string | null
}

/** What the admin sends to add or edit an entry (checked again on the server). */
export type TimelineEntryInput = {
  date: string
  time?: string | null
  title: string
  body?: RichTextDoc | string | null
  photoIds?: number[]
}

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/** Newest first, as the admin lists them: by day, then time (an entry without a time counts as the start of its day), then id. */
export function compareTimelineNewestFirst(a: Pick<TimelineEntry, 'date' | 'time' | 'id'>, b: Pick<TimelineEntry, 'date' | 'time' | 'id'>): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  const at = a.time ?? ''
  const bt = b.time ?? ''
  if (at !== bt) return at < bt ? 1 : -1
  return b.id - a.id
}

/** The Pet timeline block's layout. */
export const TIMELINE_ALIGNMENTS = ['left', 'right', 'alternate'] as const
export type TimelineAlignment = (typeof TIMELINE_ALIGNMENTS)[number]
