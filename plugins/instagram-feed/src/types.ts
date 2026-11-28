// The Instagram feed plugin's shared shapes and limits. Pure: no imports, so the block (loaded by
// the browser), the server rules and the admin screens can all use it.

export const INSTAGRAM_FEED = 'instagram-feed'
/** The block's type in saved pages. Never change it. */
export const BLOCK_NAME = 'InstagramFeed'

/** How many posts a feed shows (pinned posts included). */
export const MIN_POSTS = 5
export const MAX_POSTS = 10
export const DEFAULT_POSTS = 6
/** Columns of the grid on a wide screen. */
export const MIN_COLUMNS = 2
export const MAX_COLUMNS = 5
export const DEFAULT_COLUMNS = 3
/** How many posts can be pinned to the start of the feed (Instagram's own limit is three). */
export const MAX_PINNED = 3

/** Instagram account types that may be connected. Personal accounts are refused. */
export const ALLOWED_ACCOUNT_TYPES = ['BUSINESS', 'MEDIA_CREATOR'] as const

/** A whole number inside a range, or the fallback for anything else (saved options are unchecked). */
export function clampWhole(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback
}

/** One post, as the feed draws it. Every address here was checked on the server (https, Instagram's own hosts). */
export type FeedPost = {
  id: string
  /** The post on instagram.com. */
  permalink: string
  /** A still picture of the post (a video's cover, an album's first picture). */
  imageUrl: string
  /** The start of the caption, as the picture's text alternative; '' when there is none. */
  alt: string
  kind: 'image' | 'video' | 'album'
  /** Pinned to the start of the feed. */
  pinned: boolean
  /** When it was posted (ISO 8601). */
  postedAt: string
}

export type FeedProfile = {
  /** The handle, without the @. */
  username: string
  name: string | null
  biography: string | null
  pictureUrl: string | null
  followers: number | null
  posts: number | null
  /** https://www.instagram.com/<username>/ */
  profileUrl: string
}

/** What the block's loader returns, and what the block and the dashboard card draw. */
export type InstagramFeedData = {
  profile: FeedProfile
  /** Already chosen and ordered for the block that asked: pinned first (when included), then the latest. */
  posts: FeedPost[]
  /** When this was read from Instagram (ISO 8601). */
  fetchedAt: string
}

type Shown = 'show' | 'hide'

/** The block's saved options. Every one is optional: a missing value means the default. */
export type InstagramFeedProps = {
  heading?: string
  /** MIN_POSTS to MAX_POSTS. */
  count?: number
  /** MIN_COLUMNS to MAX_COLUMNS. */
  columns?: number
  /** Whether pinned posts lead the feed (they count towards `count`). Default: include. */
  pinned?: 'include' | 'exclude'
  /** Which side the profile photo sits on. Default: left, as on Instagram. */
  photoSide?: 'left' | 'right'
  showPhoto?: Shown
  showName?: Shown
  showHandle?: Shown
  showPosts?: Shown
  showFollowers?: Shown
  showBio?: Shown
  showGrid?: Shown
  showMore?: Shown
  /** The "show more" button's text. Default: "Show more on Instagram". */
  moreLabel?: string
}

/** What the admin's Instagram screen shows. Never holds a secret or a token. */
export type ConnectionView = {
  appId: string
  /** Whether an app secret is saved (it is never sent back). */
  appSecretSet: boolean
  /** The address to enter in the Meta app as its OAuth redirect URI. */
  redirectUri: string
  connected: boolean
  /** How it was connected: through Instagram's sign-in, or with a pasted access token. */
  method: 'oauth' | 'token' | null
  account: { username: string; name: string | null; accountType: string; pictureUrl: string | null } | null
  /** ISO 8601, or null when unknown. */
  tokenExpiresAt: string | null
  connectedAt: string | null
  lastFetchedAt: string | null
  /** Why the last read from Instagram failed, in words for the owner; null when it worked. */
  lastError: string | null
  /** Whether the person looking may change it (admins and developers). */
  canEdit: boolean
}
