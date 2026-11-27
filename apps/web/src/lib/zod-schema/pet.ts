import z from "zod";

import { estimateBirthDate, todayISO, type AgeUnit } from "@/lib/age";
import { validateHttpsUrl } from "@/lib/links";
import {
  AGE_GROUPS,
  AGE_UNITS,
  GOOD_WITH,
  normalizeSpecies,
  PET_STATUS_VALUES,
  SEXES,
  SIZES,
  SPECIES_MAX_LENGTH,
  TEMPERAMENTS,
} from "@/lib/options";
import { DESCRIPTION_MAX_CHARS, validateRichText, type RichTextDoc } from "@/lib/rich-text";
import { SLUG_PATTERN } from "@/lib/slugify";
import { normalizePhone } from "@/lib/whatsapp";

// The pet form's rules, checked in the browser before anything is sent. They reuse the server's own
// pure validators (links, phone numbers, slugs, species, age), so the two cannot drift apart; the
// server (`savePet`) is still the authority and its `fieldErrors` are shown on the same fields.
// Form values are strings, booleans and small objects with no transforms: what the person typed.
// `toPetInput` (src/lib/admin/pet-form.ts) turns them into the payload.

/** Same as MAX_PHOTOS in src/server/pets.ts (a server module, so it cannot be imported here). */
export const PET_MAX_PHOTOS = 10;

/** How the age is entered: keep what is stored, a birth date, "about N months", or not known. */
export const AGE_MODES = ["keep", "date", "estimate", "none"] as const;

const valuesOf = <T extends readonly { value: string }[]>(list: T) =>
  list.map((option) => option.value) as [T[number]["value"], ...T[number]["value"][]];

/** A select that may be left unset (the empty string). */
const optionalOf = <T extends readonly { value: string }[]>(list: T) =>
  z.enum(valuesOf(list)).or(z.literal(""));

const text = (max: number, what: string) =>
  z.string().trim().max(max, `${what} must be at most ${max} characters.`);

/** `2026-02-31` rolls over in Date.parse, so require that the date survives a round trip. */
function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

const optionalDate = z
  .string()
  .trim()
  .refine((value) => value === "" || isCalendarDate(value), "Enter a real date.");

/** An image chosen from the media library: just what the form needs to show it. */
const mediaRef = z.object({
  id: z.number().int().positive(),
  /** The original (logos and icons are previewed whole; thumbnails are 4:3 crops). */
  url: z.string(),
  thumbnailUrl: z.string(),
  alt: z.string(),
});

export const petFormSchema = z
  .object({
    name: z.string().trim().min(1, "Enter the pet's name.").max(60, "The name must be at most 60 characters."),
    species: z
      .string()
      .trim()
      .min(1, "Enter the species, for example cat or dog.")
      .max(SPECIES_MAX_LENGTH, `The species must be at most ${SPECIES_MAX_LENGTH} characters.`)
      .refine((value) => value === "" || normalizeSpecies(value) !== "", "Use letters or numbers."),
    sex: optionalOf(SEXES),
    size: optionalOf(SIZES),
    breed: text(80, "The breed"),
    color: text(60, "The colour"),
    city: text(60, "The city"),
    state: text(60, "The state"),
    /** ISO 3166-1 alpha-2, picked from a list (the server checks it is a real one). */
    country: z.string().trim().regex(/^([A-Za-z]{2})?$/, "Pick a country from the list."),
    location: text(120, "The location"),

    ageMode: z.enum(AGE_MODES),
    birthDate: z.string().trim(),
    ageValue: z.string().trim(),
    ageUnit: optionalOf(AGE_UNITS),
    ageDescription: text(40, "The age description"),
    ageGroup: optionalOf(AGE_GROUPS),

    vaccinated: z.boolean(),
    neutered: z.boolean(),
    microchipped: z.boolean(),
    houseTrained: z.boolean(),
    specialNeeds: z.boolean(),
    // A rich-text document (paragraphs, lists, bold/italic/underline, links) or null. Checked with the
    // same rules as the server (src/lib/rich-text.ts), which also caps the length.
    healthNotes: z.custom<RichTextDoc | null>().superRefine((value, context) => {
      if (value === null || value === undefined) return;
      const result = validateRichText(value);
      if (!result.ok) context.addIssue({ code: "custom", message: result.error });
    }),
    // Same rules and cap as the health notes.
    personalityNotes: z.custom<RichTextDoc | null>().superRefine((value, context) => {
      if (value === null || value === undefined) return;
      const result = validateRichText(value);
      if (!result.ok) context.addIssue({ code: "custom", message: result.error });
    }),
    temperament: z.array(z.enum(valuesOf(TEMPERAMENTS))),
    goodWith: z.array(z.enum(valuesOf(GOOD_WITH))),

    photos: z
      .array(mediaRef)
      .min(1, "Add at least 1 photo.")
      .max(PET_MAX_PHOTOS, `Use at most ${PET_MAX_PHOTOS} photos.`),
    // A rich-text document or null, checked with the server's rules and its 5000-character cap.
    description: z.custom<RichTextDoc | null>().superRefine((value, context) => {
      if (value === null || value === undefined) return;
      const result = validateRichText(value, { maxChars: DESCRIPTION_MAX_CHARS });
      if (!result.ok) context.addIssue({ code: "custom", message: result.error });
    }),
    videoUrl: text(300, "The video link").refine(
      (value) => validateHttpsUrl(value) === true,
      "Enter a full link starting with https://",
    ),

    adoptionFee: z
      .string()
      .trim()
      .refine(
        (value) => value === "" || (/^\d+(\.\d+)?$/.test(value) && Number(value) <= 1e9),
        "Enter an amount such as 150 or 150.50.",
      ),
    rescuedAt: optionalDate,
    contactWhatsApp: text(40, "The number").refine(
      (value) => value === "" || normalizePhone(value) !== "",
      "Enter a valid number, for example +60 12-345 6789.",
    ),

    seoTitle: text(70, "The search title"),
    seoDescription: text(160, "The search description"),
    seoImage: mediaRef.nullable(),

    status: z.enum(PET_STATUS_VALUES),
    featured: z.boolean(),
    unlisted: z.boolean(),
    urgent: z.boolean(),
    slug: text(80, "The address").refine(
      (value) => value === "" || SLUG_PATTERN.test(value),
      "Use lowercase letters, numbers and single dashes only.",
    ),
  })
  .superRefine((values, context) => {
    const add = (path: string, message: string) => context.addIssue({ code: "custom", path: [path], message });

    // Only the fields of the chosen way of entering the age are checked: the others are not sent.
    if (values.ageMode === "date" && values.birthDate !== "") {
      if (!isCalendarDate(values.birthDate)) add("birthDate", "Enter a real date.");
      else if (values.birthDate > todayISO()) add("birthDate", "The birth date cannot be in the future.");
    }

    if (values.ageMode === "estimate" && values.ageValue !== "") {
      const amount = Number(values.ageValue);
      if (!/^\d+$/.test(values.ageValue) || amount < 1 || amount > 200) {
        add("ageValue", "Use a whole number from 1 to 200.");
      } else if (values.ageUnit === "") {
        add("ageUnit", "Pick weeks, months or years.");
      } else if (estimateBirthDate(amount, values.ageUnit as AgeUnit) < "1850-01-01") {
        add("ageValue", "That is too old.");
      }
    }
  });

export type PetFormValues = z.infer<typeof petFormSchema>;
export type PetFormMedia = z.infer<typeof mediaRef>;
