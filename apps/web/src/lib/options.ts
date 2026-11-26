import { ROLE_INFO, ROLES as SDK_ROLES } from '@pet-adopt/plugin-sdk'
// Single source of truth for the select options used by the CMS and the public filters.

export const SPECIES = [
  { label: 'Cat', value: 'cat' },
  { label: 'Dog', value: 'dog' },
  { label: 'Rabbit', value: 'rabbit' },
  { label: 'Bird', value: 'bird' },
  { label: 'Other', value: 'other' },
] as const

// Species is free text: SPECIES lists the usual ones (curated labels, suggestions for the form), but
// an owner can type any other. Values are stored normalised so "Guinea  Pig" and "guinea-pig" are one
// species and filters match exactly.
export const SPECIES_MAX_LENGTH = 40

/** "  Guinea  Pig " -> "guinea-pig". Letters, marks and digits of any script are kept; the rest separates words. */
export function normalizeSpecies(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input
    .slice(0, 200)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Filter options for the species that are in use: the built-in ones first with their curated labels,
 * then custom ones ("guinea-pig" -> "Guinea pig") alphabetically.
 */
export function speciesOptions(values: readonly string[]): Option[] {
  const present = new Set(values.filter(Boolean))
  const builtIn = new Set<string>(SPECIES.map((s) => s.value))
  const known: Option[] = SPECIES.filter((s) => present.has(s.value)).map(({ label, value }) => ({ label, value }))
  const custom: Option[] = [...present]
    .filter((value) => !builtIn.has(value))
    .map((value) => ({ label: humanize(value), value }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return [...known, ...custom]
}

// The values are stored as plain text (so the same column works on SQLite and PostgreSQL), but the
// code uses this enum: `pet.status === PetStatus.Adopted`, not the string. Keep it free of imports
// because the schema files and drizzle-kit load it.
export enum PetStatus {
  Available = 'available',
  Pending = 'pending',
  Adopted = 'adopted',
}

export const STATUSES = [
  { label: 'Available', value: PetStatus.Available },
  { label: 'Pending', value: PetStatus.Pending },
  { label: 'Adopted', value: PetStatus.Adopted },
] as const

/** Every status, for `<select>`s, URL parsers (`parseAsStringEnum`) and the database column. */
export const PET_STATUS_VALUES = Object.values(PetStatus) as [PetStatus, ...PetStatus[]]

/** Narrows anything (a URL value, a block prop, a request body) to a real status. */
export const isPetStatus = (value: unknown): value is PetStatus =>
  typeof value === 'string' && (PET_STATUS_VALUES as readonly string[]).includes(value)

export const SEXES = [
  { label: 'Male', value: 'male' },
  { label: 'Female', value: 'female' },
  { label: 'Unknown', value: 'unknown' },
] as const

export const AGE_GROUPS = [
  { label: 'Baby', value: 'baby' },
  { label: 'Young', value: 'young' },
  { label: 'Adult', value: 'adult' },
  { label: 'Senior', value: 'senior' },
] as const

// The unit of "about 8 months old". The age group of a pet with a birth date is worked out from it
// (see src/lib/age.ts); AGE_GROUPS is what the filter offers and the fallback for pets without one.
export const AGE_UNITS = [
  { label: 'Weeks', value: 'weeks' },
  { label: 'Months', value: 'months' },
  { label: 'Years', value: 'years' },
] as const

export const SIZES = [
  { label: 'Small', value: 'small' },
  { label: 'Medium', value: 'medium' },
  { label: 'Large', value: 'large' },
] as const

export const TEMPERAMENTS = [
  { label: 'Calm', value: 'calm' },
  { label: 'Playful', value: 'playful' },
  { label: 'Energetic', value: 'energetic' },
  { label: 'Affectionate', value: 'affectionate' },
  { label: 'Independent', value: 'independent' },
  { label: 'Shy', value: 'shy' },
] as const

export const GOOD_WITH = [
  { label: 'Children', value: 'kids' },
  { label: 'Dogs', value: 'dogs' },
  { label: 'Cats', value: 'cats' },
  { label: 'Other pets', value: 'other-pets' },
] as const

// Roles for the people who sign in, as options. What each may do is the table in the plugin SDK.
export const ROLES = SDK_ROLES.map((value) => ({ value, label: ROLE_INFO[value].label }))

export const SOCIAL_PLATFORMS = [
  { label: 'Instagram', value: 'instagram' },
  { label: 'Facebook', value: 'facebook' },
  { label: 'TikTok', value: 'tiktok' },
  { label: 'YouTube', value: 'youtube' },
  { label: 'X / Twitter', value: 'x' },
  { label: 'Telegram', value: 'telegram' },
  { label: 'Website', value: 'website' },
  { label: 'Other', value: 'other' },
] as const

export type Option = { label: string; value: string }

/** "guinea-pig" -> "Guinea pig". Used when a stored value has no curated label (custom species). */
function humanize(value: string): string {
  const text = value.replace(/[-_]+/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export const labelFor = (options: readonly Option[], value?: string | null) =>
  options.find((o) => o.value === value)?.label ?? humanize(value ?? '')

// Slugs that belong to fixed routes and therefore can't be used for builder pages.
export const RESERVED_SLUGS = ['admin', 'api', 'edit', 'health', 'media', 'pets', 'pet-page', 'setup', '_next']
