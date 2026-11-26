import type { SocialLink } from '@/components/site/SocialIcons'
import type { PublicForm } from '@pet-adopt/plugin-form-builder/server'
import type { CatalogData, CatalogParams, PetCardData, PetFilters, PetPageData, PetSpotlightData } from '@/lib/queries'

/** What the media picker stores in a block. */
export type MediaValue = { id: number | string; url: string; alt: string } | null

/**
 * Passed to Puck as `metadata` in the editor and on the public site, so blocks can read
 * site-wide settings and fetch live pets without importing server-only code.
 */
export type PuckSiteMetadata = {
  site: {
    siteName: string
    whatsappNumber?: string | null
    whatsappMessage?: string | null
    address?: string | null
    openingHours?: string | null
    socials: SocialLink[]
  }
  fetchPets: (filters: PetFilters) => Promise<PetCardData[]>
  /** One pet for the Pet spotlight; null when it is unlisted, adopted or gone. */
  fetchPet: (id: number) => Promise<PetSpotlightData | null>
  /** Full profiles for the Pet grid's profile layout. */
  fetchPetProfiles: (filters: PetFilters) => Promise<PetSpotlightData[]>
  /** One page of the pet catalogue for a query string (the Pet catalogue block). */
  fetchCatalog: (params: CatalogParams) => Promise<CatalogData>
  /** One form from the form builder for the Form block; null when it is gone (or the plugin is not set up). */
  fetchForm?: (id: number) => Promise<PublicForm | null>
  /** The page's query string (filters, page number), on the live site only. */
  searchParams?: CatalogParams
  /**
   * The Pet page template only: the pet whose page is drawn (on the site, the one in the address; in
   * the editor, the "Preview with" pet). Null in the editor until a pet is picked.
   */
  pet?: PetPageData | null
  /** The Pet page template's "More pets like this" (the ranking is rankSimilarPets). */
  fetchSimilarPets?: (pet: { id: number; species: string; state: string | null }, limit: number) => Promise<PetCardData[]>
}
