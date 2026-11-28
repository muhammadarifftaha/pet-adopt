import { formatWhen } from '@pet-adopt/plugin-sdk'

import type { TimelineEntry } from '@/lib/pet-timeline'

// How a timeline entry's date and time are written, shared by the Pet timeline block and the admin's
// Timeline section. An entry stores a calendar day (YYYY-MM-DD) and an optional wall-clock time
// (HH:MM) that are already in the site's time zone: they are not instants. So the day is formatted
// as that day at midnight UTC in UTC (with the SDK's one fixed format), which never shifts it, and the
// time is shown as stored. Converting them with the site's time zone would move them a second time.

/** "28 November 2026" or "28 November 2026, 14:30" (`withTime` false drops the time). */
export function timelineWhenText(entry: Pick<TimelineEntry, 'date' | 'time'>, withTime = true, style: 'date' | 'longDate' = 'longDate'): string {
  const day = formatWhen(`${entry.date}T00:00:00Z`, 'UTC', style) || entry.date
  return withTime && entry.time ? `${day}, ${entry.time}` : day
}

/** The `<time dateTime>` value: "2026-11-28" or "2026-11-28T14:30" (a local date and time). */
export function timelineDateTimeAttr(entry: Pick<TimelineEntry, 'date' | 'time'>, withTime = true): string {
  return withTime && entry.time ? `${entry.date}T${entry.time}` : entry.date
}
