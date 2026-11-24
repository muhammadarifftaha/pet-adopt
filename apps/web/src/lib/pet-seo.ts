// The text search engines and link previews get for a pet's page. The public pet page
// (`generateMetadata`) and the admin's "Search and sharing" preview both call this, so what the
// owner sees in the preview is what the page really sends. Pure: plain strings in, plain strings out.

export type PetSeoInput = {
  name: string
  status: string
  /** The species as shown to people ("Guinea pig"), already labelled. */
  speciesLabel: string
  breed?: string | null
  ageDescription?: string | null
  location?: string | null
  /** The owner's own title and description. Blank means "build one". */
  seoTitle?: string | null
  seoDescription?: string | null
}

export type PetSeo = {
  /** Without the site name: the page adds " | Site name" itself. */
  title: string
  description: string
  titleIsAutomatic: boolean
  descriptionIsAutomatic: boolean
}

export function petSeo(input: PetSeoInput): PetSeo {
  const ownTitle = input.seoTitle?.trim()
  const ownDescription = input.seoDescription?.trim()
  const summary = [input.speciesLabel, input.breed, input.ageDescription, input.location]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' · ')
  const name = input.name.trim() || 'This pet'
  return {
    title: ownTitle || `${name}${input.status === 'adopted' ? ' (adopted)' : ' is looking for a home'}`,
    description: ownDescription || summary,
    titleIsAutomatic: !ownTitle,
    descriptionIsAutomatic: !ownDescription,
  }
}
