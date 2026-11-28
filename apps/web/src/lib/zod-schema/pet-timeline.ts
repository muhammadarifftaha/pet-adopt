import z from "zod";

import {
  TIME_PATTERN,
  TIMELINE_MAX_PHOTOS,
  TIMELINE_TEXT_MAX_CHARS,
  TIMELINE_TITLE_MAX,
  type TimelineEntry,
  type TimelineEntryInput,
} from "@/lib/pet-timeline";
import { validateRichText, type RichTextDoc } from "@/lib/rich-text";

// The timeline update form's rules (Timeline section of a pet's edit page), checked in the browser
// before anything is sent. They reuse the shared limits and the rich-text validator, so they match
// the server's rules (src/server/pet-timeline.ts), which stay the authority: its `fieldErrors`
// (keys date, time, title, body, photoIds) are shown on the same fields.

/** `2026-02-31` rolls over in Date.parse, so require that the date survives a round trip. */
function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** A photo chosen from the media library, as the form shows it. */
const photoRef = z.object({
  id: z.number().int().positive(),
  url: z.string(),
  thumbnailUrl: z.string(),
  alt: z.string(),
});
export type TimelineFormPhoto = z.infer<typeof photoRef>;

export const timelineEntrySchema = z.object({
  date: z
    .string()
    .trim()
    .min(1, "Enter the date.")
    .refine((value) => value === "" || isCalendarDate(value), "Enter a real date."),
  time: z
    .string()
    .trim()
    .refine((value) => value === "" || TIME_PATTERN.test(value), "Enter a time like 14:30, or leave it empty."),
  title: z
    .string()
    .trim()
    .min(1, "Enter a title.")
    .max(TIMELINE_TITLE_MAX, `The title must be at most ${TIMELINE_TITLE_MAX} characters.`),
  body: z.custom<RichTextDoc | null>().superRefine((value, context) => {
    if (value === null || value === undefined) return;
    const result = validateRichText(value, { maxChars: TIMELINE_TEXT_MAX_CHARS });
    if (!result.ok) context.addIssue({ code: "custom", message: result.error });
  }),
  photos: z.array(photoRef).max(TIMELINE_MAX_PHOTOS, `Use at most ${TIMELINE_MAX_PHOTOS} photos.`),
});

export type TimelineEntryFormValues = z.infer<typeof timelineEntrySchema>;

export const TIMELINE_FIELD_LABELS: Record<keyof TimelineEntryFormValues, string> = {
  date: "Date",
  time: "Time",
  title: "Title",
  body: "Text",
  photos: "Photos",
};
export const TIMELINE_FIELD_ORDER = ["date", "time", "title", "body", "photos"] as const;

/** A server field error key (`photoIds`, `photoIds.2`, `body`) mapped to the form's field. */
export function timelineFieldFor(key: string): keyof TimelineEntryFormValues | null {
  const head = key.split(".")[0];
  if (head === "photoIds") return "photos";
  return (TIMELINE_FIELD_ORDER as readonly string[]).includes(head) ? (head as keyof TimelineEntryFormValues) : null;
}

/** The form's values for a new update (today, no time) or an existing one. */
export function timelineToFormValues(entry: TimelineEntry | null, today: string): TimelineEntryFormValues {
  if (!entry) return { date: today, time: "", title: "", body: null, photos: [] };
  return {
    date: entry.date,
    time: entry.time ?? "",
    title: entry.title,
    body: entry.body,
    photos: photosOf(entry),
  };
}

/**
 * The entry's photos with their ids, for editing. `photos` leaves out deleted images, so it is only
 * paired with `photoIds` when nothing is missing (or when the server sends each photo's id).
 */
function photosOf(entry: TimelineEntry): TimelineFormPhoto[] {
  const withIds = entry.photos.every((photo) => typeof (photo as { id?: unknown }).id === "number");
  if (withIds) {
    return entry.photos.map((photo) => ({
      id: (photo as unknown as { id: number }).id,
      url: photo.url,
      thumbnailUrl: photo.thumbnailUrl ?? photo.url,
      alt: photo.alt,
    }));
  }
  if (entry.photos.length !== entry.photoIds.length) return [];
  return entry.photos.map((photo, index) => ({
    id: entry.photoIds[index],
    url: photo.url,
    thumbnailUrl: photo.thumbnailUrl ?? photo.url,
    alt: photo.alt,
  }));
}

/** What the actions receive. */
export function toTimelineInput(values: TimelineEntryFormValues): TimelineEntryInput {
  return {
    date: values.date.trim(),
    time: values.time.trim() || null,
    title: values.title.trim(),
    body: values.body,
    photoIds: values.photos.map((photo) => photo.id),
  };
}
