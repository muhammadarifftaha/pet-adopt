// Domain types: what the rest of the app sees. Repositories map database rows into these, so
// nothing outside `src/server` and `src/db` depends on Drizzle.
import type { PetStatus } from '@/lib/options'
import type { RichTextDoc } from '@/lib/rich-text'
import type { ThemeSettings } from '@/lib/theme'

export type MediaItem = {
  id: number
  filename: string
  mimeType: string
  size: number
  width: number | null
  height: number | null
  alt: string
  /** Display name chosen at upload (null for older images); the file itself keeps a random name. */
  name: string | null
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
  status: PetStatus
  sex: string | null
  /**
   * The pet's age as text. Worked out from the birth date when there is one ("3 months", "About 8
   * months", so it keeps up with time), else the text an owner typed.
   */
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
  /** `YYYY-MM-DD`. Estimated when `birthDateEstimated` is set ("about 8 months old" turned into a date). */
  birthDate: string | null
  birthDateEstimated: boolean
  color: string | null
  city: string | null
  state: string | null
  vaccinated: boolean
  neutered: boolean
  microchipped: boolean
  houseTrained: boolean
  specialNeeds: boolean
  /** A rich-text document (paragraphs, lists, bold/italic/underline, links). Old plain-text notes arrive converted. */
  healthNotes: RichTextDoc | null
  temperament: string[]
  goodWith: string[]
  /** Plain text. Blank lines separate paragraphs. */
  /** A rich-text document, like `healthNotes`. An old plain-text description arrives converted. */
  description: RichTextDoc | null
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
/** What the admin shows: the stored status, or 'archived' while `archivedAt` is set. */
export type PageState = PageStatus | 'archived'

/** 'draft': the open version, collecting saves until the next publish. 'published': closed. */
export type PageVersionKind = 'draft' | 'published'

/** One saved snapshot of a page's layout (without the layout itself). */
export type PageVersionSummary = {
  number: number
  kind: PageVersionKind
  title: string
  createdAt: Date
  /** Last saved (an open version is saved many times; a published one, when it was published). */
  updatedAt: Date
  /** The version this one was restored from, if any (a restore is always a new version). */
  restoredFrom: number | null
  /** Name of the person who saved it last, or null when that account was deleted. */
  createdBy: string | null
}

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
  /** Set while the page is archived (off the site, read-only). */
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
  /**
   * Settings saved but not published yet (a live page only): what the settings form and page builder
   * show, while visitors still get title/slug/seo above. Null when there are none.
   */
  draftDetails: { title: string; slug: string; seo: { description: string | null; image: MediaItem | null } } | null
}

export type SiteSetting = {
  id: number
  siteName: string
  tagline: string | null
  logo: MediaItem | null
  /** The browser tab icon (square image). */
  favicon: MediaItem | null
  primaryColor: string | null
  theme: string
  allowModeToggle: boolean
  customize: boolean
  customTheme: ThemeSettings['customTheme']
  /**
   * The owner's saved theme in use, or null for the built-in preset in `theme`. When set,
   * getSettings has already laid it over `theme`, `customize`, `customTheme` and `primaryColor`.
   */
  activeThemeId: number | null
  whatsappNumber: string | null
  whatsappMessage: string | null
  address: string | null
  openingHours: string | null
  socials: Array<{ platform: string; url: string }>
  nav: Array<{ label: string; href: string }>
  footerText: string | null
  updatedAt: Date | null
}

/** An owner's saved theme: a preset (`base`) plus their customisations. */
export type ThemeRecord = {
  id: number
  name: string
  base: string
  settings: NonNullable<ThemeSettings['customTheme']>
  createdAt: Date
  updatedAt: Date
}

// Roles and what they may do live in the plugin SDK (one table for the app and plugins).
export type { Role } from '@pet-adopt/plugin-sdk'
import type { Role } from '@pet-adopt/plugin-sdk'

export type SessionUser = {
  id: string
  email: string
  name: string
  role: Role
  /** Two-factor sign-in is set up (an authenticator app was confirmed). */
  twoFactorEnabled: boolean
  /** How this session signed in: 'password', or 'provider:<id>' for a sign-in provider. */
  signInMethod: string
  /** Profile picture address, or null (initials). */
  image?: string | null
  /** They confirmed they read their email (src/server/email-change.ts); unset counts as confirmed. */
  emailVerified?: boolean
}

/** The answer to a sign-in with email and password: signed in, or a code is needed next. */
export type SignInResult = { twoFactor: false; user: SessionUser } | { twoFactor: true }
