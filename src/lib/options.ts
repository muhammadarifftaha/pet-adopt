// Single source of truth for the select options used by the CMS and the public filters.

export const SPECIES = [
  { label: 'Cat', value: 'cat' },
  { label: 'Dog', value: 'dog' },
  { label: 'Rabbit', value: 'rabbit' },
  { label: 'Bird', value: 'bird' },
  { label: 'Other', value: 'other' },
] as const

export const STATUSES = [
  { label: 'Available', value: 'available' },
  { label: 'Pending', value: 'pending' },
  { label: 'Adopted', value: 'adopted' },
] as const

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

// Roles for the people who sign in. Admins also manage users and site settings; editors manage
// pets, pages and media.
export const ROLES = [
  { label: 'Admin', value: 'admin' },
  { label: 'Editor', value: 'editor' },
] as const

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

export const labelFor = (options: readonly Option[], value?: string | null) =>
  options.find((o) => o.value === value)?.label ?? value ?? ''

// Slugs that belong to fixed routes and therefore can't be used for builder pages.
export const RESERVED_SLUGS = ['admin', 'api', 'edit', 'health', 'pets', '_next']
