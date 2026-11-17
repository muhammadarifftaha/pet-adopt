// Domain types: what the rest of the app sees. Repositories map database rows into these, so
// nothing outside `src/server` and `src/db` depends on Drizzle.
import type { ThemeSettings } from '@/lib/theme'

export type MediaItem = {
  id: number
  filename: string
  mimeType: string
  size: number
  width: number | null
  height: number | null
  alt: string
  /** Public URL of the original, for example /media/3f2a....webp */
  url: string
  /** Small preview for lists. */
  thumbnailUrl: string
  createdAt: Date
  updatedAt: Date
}

/** The few fields a card or a list row needs. */
export type PetSummary = {
  id: number
  slug: string
  name: string
  species: string
  status: string
  sex: string | null
  ageDescription: string | null
  location: string | null
  featured: boolean
  unlisted: boolean
  urgent: boolean
  updatedAt: Date
  /** Only the cover photo is loaded for summaries. */
  photos: MediaItem[]
}

export type Pet = Omit<PetSummary, 'photos'> & {
  adoptedAt: Date | null
  breed: string | null
  ageGroup: string | null
  size: string | null
  birthDate: string | null
  color: string | null
  city: string | null
  state: string | null
  vaccinated: boolean
  neutered: boolean
  microchipped: boolean
  houseTrained: boolean
  specialNeeds: boolean
  healthNotes: string | null
  temperament: string[]
  goodWith: string[]
  /** Plain text. Blank lines separate paragraphs. */
  description: string | null
  videoUrl: string | null
  adoptionFee: number | null
  rescuedAt: string | null
  contactWhatsApp: string | null
  photos: MediaItem[]
  seo: { title: string | null; description: string | null; image: MediaItem | null }
  createdAt: Date
}

export type PetPage = {
  docs: PetSummary[]
  totalDocs: number
  totalPages: number
  page: number
  limit: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

export type PageStatus = 'draft' | 'published'

export type Page = {
  id: number
  title: string
  slug: string
  status: PageStatus
  /** What the page builder edits. */
  puckDraft: unknown | null
  /** What visitors see. Null until the page is published. */
  puckPublished: unknown | null
  seo: { description: string | null; image: MediaItem | null }
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type SiteSetting = {
  id: number
  siteName: string
  tagline: string | null
  logo: MediaItem | null
  primaryColor: string | null
  theme: string
  allowModeToggle: boolean
  customize: boolean
  customTheme: ThemeSettings['customTheme']
  whatsappNumber: string | null
  whatsappMessage: string | null
  address: string | null
  openingHours: string | null
  socials: Array<{ platform: string; url: string }>
  nav: Array<{ label: string; href: string }>
  footerText: string | null
  updatedAt: Date | null
}

export type Role = 'admin' | 'editor'

export type SessionUser = {
  id: string
  email: string
  name: string
  role: Role
}
