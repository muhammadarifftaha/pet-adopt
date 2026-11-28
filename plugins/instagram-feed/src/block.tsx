// The Instagram feed block: the half the page builder loads in the browser and the site draws on
// the server (see "Page builder blocks" in @pet-adopt/plugin-sdk). So: no hooks, no browser-only
// code and no server-only imports. What it shows comes from the plugin's loader as `data`.
//
// Saved options are unchecked: numbers are clamped, a show/hide option hides only when it is
// exactly 'hide', and no saved value reaches a class name or a style. Addresses were checked on
// the server before they were stored; a link or picture is still drawn only for an https address.

import { definePluginBlock } from '@pet-adopt/plugin-sdk'

import { BLOCK_CSS } from './block-css'
import {
  BLOCK_NAME,
  DEFAULT_COLUMNS,
  DEFAULT_POSTS,
  INSTAGRAM_FEED,
  MAX_COLUMNS,
  MAX_POSTS,
  MIN_COLUMNS,
  MIN_POSTS,
  clampWhole,
  type FeedPost,
  type FeedProfile,
  type InstagramFeedData,
  type InstagramFeedProps,
} from './types'

const DEFAULT_MORE_LABEL = 'Show more on Instagram'
const MAX_LABEL = 80

const SHOWN = [
  { label: 'Show', value: 'show' },
  { label: 'Hide', value: 'hide' },
] as const

/** Whole numbers as a select's choices. */
function wholeChoices(min: number, max: number) {
  return Array.from({ length: max - min + 1 }, (_, index) => ({ label: String(min + index), value: min + index }))
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Everything but an exact 'hide' shows the part: a missing or damaged option keeps the default look. */
function shown(value: unknown): boolean {
  return value !== 'hide'
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function httpsAddress(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('https://') ? value : null
}

function wholeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * 4,210 / 12.5K / 1.2M. Written by hand (no Intl) so the server and every browser draw the same
 * text. Cut, not rounded, to one decimal, as Instagram does (12,580 is "12.5K").
 */
export function compactNumber(value: number): string {
  if (value < 10_000) return grouped(value)
  const [unit, letter] = value < 1_000_000 ? [1_000, 'K'] : value < 1_000_000_000 ? [1_000_000, 'M'] : [1_000_000_000, 'B']
  const tenths = Math.floor((value / unit) * 10)
  const whole = Math.floor(tenths / 10)
  const decimal = tenths % 10
  return `${grouped(whole)}${decimal ? `.${decimal}` : ''}${letter}`
}

/** "12 March 2026" in UTC, or '' for a date that cannot be read. The same text on server and browser. */
function postedOn(iso: unknown): string {
  if (typeof iso !== 'string') return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

type Tile = { key: string; href: string; src: string; alt: string; kind: 'image' | 'video' | 'album'; pinned: boolean }

function toTiles(posts: unknown, count: number): Tile[] {
  if (!Array.isArray(posts)) return []
  const tiles: Tile[] = []
  for (const [index, item] of posts.entries()) {
    if (tiles.length >= count) break
    if (!item || typeof item !== 'object') continue
    const post = item as Partial<FeedPost>
    const href = httpsAddress(post.permalink)
    const src = httpsAddress(post.imageUrl)
    if (!href || !src) continue
    const date = postedOn(post.postedAt)
    tiles.push({
      key: `${index}-${typeof post.id === 'string' ? post.id : ''}`,
      href,
      src,
      alt: text(post.alt) || (date ? `Instagram post from ${date}` : 'Instagram post'),
      kind: post.kind === 'video' || post.kind === 'album' ? post.kind : 'image',
      pinned: post.pinned === true,
    })
  }
  return tiles
}

// Decorative: what they say is in the tile's hidden text.
function KindIcon({ kind }: { kind: 'video' | 'album' }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {kind === 'video' ? <path d="M4 2.5v11l9-5.5z" /> : <path d="M2 5h9v9H2zM5 2h9v9h-1.5V3.5H5z" />}
    </svg>
  )
}

function PostTile({ tile }: { tile: Tile }) {
  const notes = [tile.pinned ? 'Pinned' : '', tile.kind === 'video' ? 'Video' : tile.kind === 'album' ? 'Album' : '', 'Opens on Instagram'].filter(Boolean)
  return (
    <li>
      <a className="ig-feed-tile" href={tile.href} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element -- the picture is on Instagram's servers; a plugin block cannot use next/image */}
        <img src={tile.src} alt={tile.alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        {tile.pinned || tile.kind !== 'image' ? (
          <span className="ig-feed-marks" aria-hidden="true">
            {tile.pinned ? <span className="ig-feed-mark">Pinned</span> : null}
            {tile.kind !== 'image' ? (
              <span className="ig-feed-mark ig-feed-mark-kind">
                <KindIcon kind={tile.kind} />
              </span>
            ) : null}
          </span>
        ) : null}
        <span className="ig-feed-hidden"> ({notes.join('. ')})</span>
      </a>
    </li>
  )
}

function Note({ title, children }: { title: string; children: string }) {
  return (
    <section className="section ig-feed">
      <div className="container">
        <p className="ig-feed-note">
          <strong>{title}</strong>
          {children}
        </p>
      </div>
    </section>
  )
}

export const instagramFeedBlock = definePluginBlock<InstagramFeedProps, InstagramFeedData>({
  name: BLOCK_NAME,
  label: 'Instagram feed',
  plugin: INSTAGRAM_FEED,
  needsData: true,
  // The loader reads these two; changing any other option redraws the block without asking again.
  dataOptions: ['count', 'pinned'],
  fields: {
    heading: { type: 'text', label: 'Heading' },
    // Selects, not number fields: the page builder's number field refuses every keystroke that is
    // outside min and max, so "10" could not be typed (its first digit, 1, is under the minimum).
    // The saved value is still a number, so pages saved with the older number field keep theirs.
    count: { type: 'select', label: 'Number of posts', options: wholeChoices(MIN_POSTS, MAX_POSTS) },
    columns: { type: 'select', label: 'Columns on a wide screen', options: wholeChoices(MIN_COLUMNS, MAX_COLUMNS) },
    pinned: {
      type: 'radio',
      label: 'Pinned posts',
      options: [
        { label: 'Include first', value: 'include' },
        { label: 'Leave out', value: 'exclude' },
      ],
    },
    photoSide: {
      type: 'radio',
      label: 'Profile photo side',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Right', value: 'right' },
      ],
    },
    showPhoto: { type: 'radio', label: 'Profile photo', options: SHOWN },
    showHandle: { type: 'radio', label: 'Handle', options: SHOWN },
    showPosts: { type: 'radio', label: 'Number of posts on the profile', options: SHOWN },
    showFollowers: { type: 'radio', label: 'Number of followers', options: SHOWN },
    showName: { type: 'radio', label: 'Name', options: SHOWN },
    showBio: { type: 'radio', label: 'Biography', options: SHOWN },
    showGrid: { type: 'radio', label: 'Grid of posts', options: SHOWN },
    showMore: { type: 'radio', label: 'Show more button', options: SHOWN },
    moreLabel: { type: 'text', label: 'Show more button text' },
  },
  defaultProps: {
    heading: '',
    count: DEFAULT_POSTS,
    columns: DEFAULT_COLUMNS,
    pinned: 'include',
    photoSide: 'left',
    showPhoto: 'show',
    showHandle: 'show',
    showPosts: 'show',
    showFollowers: 'show',
    showName: 'show',
    showBio: 'show',
    showGrid: 'show',
    showMore: 'show',
    moreLabel: DEFAULT_MORE_LABEL,
  },
  css: BLOCK_CSS,
  render: (props) => {
    const { data, editing } = props
    const profile: Partial<FeedProfile> | null = data && typeof data === 'object' && data.profile && typeof data.profile === 'object' ? data.profile : null

    if (!profile) {
      if (!editing) return null
      return <Note title="No Instagram account is connected yet.">Connect one under Plugins &gt; Instagram, and the profile and its latest posts appear here.</Note>
    }

    const count = clampWhole(props.count, MIN_POSTS, MAX_POSTS, DEFAULT_POSTS)
    const columns = clampWhole(props.columns, MIN_COLUMNS, MAX_COLUMNS, DEFAULT_COLUMNS)
    const heading = text(props.heading)
    const Heading = props.headingLevel === 1 ? 'h1' : 'h2'

    const username = text(profile.username).replace(/^@+/, '')
    const profileUrl = httpsAddress(profile.profileUrl)
    const pictureUrl = httpsAddress(profile.pictureUrl)
    const name = text(profile.name)
    const biography = text(profile.biography)
    const posts = wholeCount(profile.posts)
    const followers = wholeCount(profile.followers)

    const withPhoto = shown(props.showPhoto)
    const handle = shown(props.showHandle) ? username : ''
    const counts = [
      shown(props.showPosts) && posts !== null ? { key: 'posts', value: posts, word: posts === 1 ? 'post' : 'posts' } : null,
      shown(props.showFollowers) && followers !== null ? { key: 'followers', value: followers, word: followers === 1 ? 'follower' : 'followers' } : null,
    ].filter((entry) => entry !== null)
    const shownName = shown(props.showName) ? name : ''
    const shownBio = shown(props.showBio) ? biography : ''
    const hasSummary = Boolean(handle || counts.length || shownName || shownBio)
    const hasProfile = withPhoto || hasSummary

    const tiles = shown(props.showGrid) ? toTiles(data?.posts, count) : []
    const moreHref = shown(props.showMore) ? profileUrl : null
    const moreLabel = text(props.moreLabel).slice(0, MAX_LABEL) || DEFAULT_MORE_LABEL

    if (!heading && !hasProfile && !tiles.length && !moreHref) {
      if (!editing) return null
      return <Note title="Nothing to show.">Every part of this block is hidden, or the account has no posts yet.</Note>
    }

    const who = username ? `@${username}` : name || 'this account'

    return (
      <section className="section ig-feed">
        <div className="container">
          {heading ? <Heading className="block-heading">{heading}</Heading> : null}
          {hasProfile ? (
            <div className="ig-feed-profile" data-photo-side={props.photoSide === 'right' ? 'right' : 'left'}>
              {withPhoto ? (
                pictureUrl ? (
                  <span className="ig-feed-photo">
                    {/* eslint-disable-next-line @next/next/no-img-element -- the picture is on Instagram's servers; a plugin block cannot use next/image */}
                    <img src={pictureUrl} alt={`Profile photo of ${who}`} width={112} height={112} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                  </span>
                ) : (
                  <span className="ig-feed-photo" aria-hidden="true">
                    {(username || name).slice(0, 1).toUpperCase()}
                  </span>
                )
              ) : null}
              {hasSummary ? (
                <div className="ig-feed-summary">
                  {handle ? (
                    <p className="ig-feed-handle">
                      {profileUrl ? (
                        <a href={profileUrl} target="_blank" rel="noopener noreferrer">
                          @{handle}
                          <span className="ig-feed-hidden"> (opens on Instagram)</span>
                        </a>
                      ) : (
                        <>@{handle}</>
                      )}
                    </p>
                  ) : null}
                  {counts.length ? (
                    <ul className="ig-feed-counts">
                      {counts.map((entry) => (
                        <li key={entry.key}>
                          <strong>{compactNumber(entry.value)}</strong> {entry.word}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {shownName ? <p className="ig-feed-name">{shownName}</p> : null}
                  {shownBio ? <p className="ig-feed-bio">{shownBio}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {tiles.length ? (
            <ul className="ig-feed-grid" data-columns={columns} aria-label={`Latest Instagram posts from ${who}`}>
              {tiles.map((tile) => (
                <PostTile key={tile.key} tile={tile} />
              ))}
            </ul>
          ) : null}
          {moreHref ? (
            <p className="ig-feed-more">
              <a className="btn btn-primary" href={moreHref} target="_blank" rel="noopener noreferrer">
                {moreLabel}
                <span className="ig-feed-hidden"> (opens in a new tab)</span>
              </a>
            </p>
          ) : null}
        </div>
      </section>
    )
  },
})
