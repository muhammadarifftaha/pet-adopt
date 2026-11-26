// Placeholders in text the owners type for the Pet page template (the WhatsApp button's label):
// {pet}, {species}, {breed}, {age}, {sex}, {location}, written like the {pet} of the site's WhatsApp
// message (src/lib/whatsapp.ts). The result is drawn as React text, never HTML.

export const PET_PLACEHOLDERS = ['pet', 'species', 'breed', 'age', 'sex', 'location'] as const
type Placeholder = (typeof PET_PLACEHOLDERS)[number]

export type PetPlaceholderValues = {
  name: string
  speciesLabel: string
  breed: string | null
  ageLabel: string | null
  sexLabel: string | null
  location: string | null
}

/**
 * The text with each known placeholder replaced by the pet's value (an empty string when the pet
 * has none, with the spaces around it tidied). Unknown `{words}` stay as typed.
 */
export function fillPetPlaceholders(template: string, pet: PetPlaceholderValues): string {
  const values: Record<Placeholder, string> = {
    pet: pet.name,
    species: pet.speciesLabel,
    breed: pet.breed ?? '',
    age: pet.ageLabel ?? '',
    sex: pet.sexLabel ?? '',
    location: pet.location ?? '',
  }
  return template
    .replace(/\{(\w+)\}/g, (whole, key: string) => ((PET_PLACEHOLDERS as readonly string[]).includes(key) ? values[key as Placeholder] : whole))
    .replace(/\s{2,}/g, ' ')
    .trim()
}
