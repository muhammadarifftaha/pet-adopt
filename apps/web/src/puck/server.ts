import { getPetSpotlight, getSettings, queryCatalog, queryPetCards, queryPetProfiles, type CatalogParams } from '@/lib/queries'
import type { SiteSetting } from '@/server/types'

import { fetchPublicForm } from './forms'
import type { PuckSiteMetadata } from './types'

export function toSiteMeta(settings: SiteSetting): PuckSiteMetadata['site'] {
  return {
    siteName: settings.siteName,
    whatsappNumber: settings.whatsappNumber,
    whatsappMessage: settings.whatsappMessage,
    address: settings.address,
    openingHours: settings.openingHours,
    socials: (settings.socials ?? []).map((s) => ({ platform: s.platform, url: s.url })),
  }
}

/** Server-side metadata for Puck: site settings plus direct (no network) pet queries. */
export async function buildSiteMetadata(searchParams?: CatalogParams): Promise<PuckSiteMetadata> {
  const settings = await getSettings()
  return {
    site: toSiteMeta(settings),
    fetchPets: (filters) => queryPetCards(filters),
    fetchPet: (id) => getPetSpotlight(id),
    fetchPetProfiles: (filters) => queryPetProfiles(filters),
    fetchCatalog: (params) => queryCatalog(params),
    fetchForm: (id) => fetchPublicForm(id),
    searchParams,
  }
}
