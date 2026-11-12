import { getSettings, queryPets, toPetCard } from '@/lib/queries'
import type { SiteSetting } from '@/payload-types'

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

/** Server-side metadata for Puck: site settings plus a direct (no network) pet query. */
export async function buildSiteMetadata(): Promise<PuckSiteMetadata> {
  const settings = await getSettings()
  return {
    site: toSiteMeta(settings),
    fetchPets: async (filters) => (await queryPets(filters)).docs.map(toPetCard),
  }
}
