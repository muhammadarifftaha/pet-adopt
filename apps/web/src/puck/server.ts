import { getPetSpotlight, getPrivacyPolicy, getSettings, queryCatalog, queryPetCards, queryPetProfiles, similarPets, type CatalogParams, type PetPageData } from '@/lib/queries'
import type { SiteSetting } from '@/server/types'

import { fetchPublicForm } from './forms'
import { fetchPluginBlockData } from './plugin-block-data'
import type { PuckSiteMetadata } from './types'

export function toSiteMeta(settings: SiteSetting, privacy: { title: string; href: string } | null = null): PuckSiteMetadata['site'] {
  return {
    siteName: settings.siteName,
    whatsappNumber: settings.whatsappNumber,
    whatsappMessage: settings.whatsappMessage,
    address: settings.address,
    openingHours: settings.openingHours,
    socials: (settings.socials ?? []).map((s) => ({ platform: s.platform, url: s.url })),
    privacy: privacy ? { title: privacy.title, href: privacy.href } : null,
  }
}

/** Server-side metadata for Puck: site settings plus direct (no network) pet queries. */
export async function buildSiteMetadata(searchParams?: CatalogParams, pet?: PetPageData | null): Promise<PuckSiteMetadata> {
  const [settings, privacy] = await Promise.all([getSettings(), getPrivacyPolicy()])
  return {
    site: toSiteMeta(settings, privacy),
    fetchPets: (filters) => queryPetCards(filters),
    fetchPet: (id) => getPetSpotlight(id),
    fetchPetProfiles: (filters) => queryPetProfiles(filters),
    fetchCatalog: (params) => queryCatalog(params),
    fetchForm: (id) => fetchPublicForm(id),
    fetchPluginBlock: (name, props) => fetchPluginBlockData(name, props),
    searchParams,
    pet,
    fetchSimilarPets: (current, limit) => similarPets(current, limit),
  }
}
