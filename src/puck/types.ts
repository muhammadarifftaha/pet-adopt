import type { SocialLink } from '@/components/site/SocialIcons'
import type { PetCardData, PetFilters } from '@/lib/queries'

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
}
