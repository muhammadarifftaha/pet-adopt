import { formatWhen } from '@pet-adopt/plugin-sdk'
import { Badge } from '@pet-adopt/ui/components/badge'

import type { FeedPost, InstagramFeedData } from '../types'

// The feed in the admin's own look: the profile in one row and the posts as small squares. Shared
// by the dashboard card (drawn on the server) and the Instagram screen's preview (drawn in the
// browser), so it is a plain function of its props: no hooks, nothing server-only.

/** Instagram's pictures are only ever loaded over https; anything else is not drawn. */
export function isHttps(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.startsWith('https://')
}

/** 1234567 -> "1,234,567". Written out so the server and the browser draw the same text. */
export function formatCount(value: number): string {
  return String(Math.max(0, Math.round(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export const KIND_LABEL: Record<FeedPost['kind'], string> = { image: 'Photo', video: 'Video', album: 'Album' }

/** A post's text alternative: the start of its caption, or what it is and when it was posted. */
export function postAlt(post: FeedPost, timeZone?: string | null): string {
  return post.alt.trim() || `${KIND_LABEL[post.kind] ?? 'Post'} posted ${formatWhen(post.postedAt, timeZone, 'date')}`
}

/** A round profile picture, or the handle's first letter when there is none to show. */
export function ProfilePhoto({ url, username, className = 'size-12' }: { url: string | null; username: string; className?: string }) {
  return isHttps(url) ? (
    // eslint-disable-next-line @next/next/no-img-element -- served by Instagram, not by this site
    <img src={url} alt="" referrerPolicy="no-referrer" loading="lazy" className={`${className} shrink-0 rounded-full border object-cover`} />
  ) : (
    <span aria-hidden="true" className={`${className} flex shrink-0 items-center justify-center rounded-full border bg-muted font-medium uppercase`}>
      {username.slice(0, 1) || '?'}
    </span>
  )
}

/** One square picture of a post. `alt` is '' when text beside it already names the post. */
export function PostPicture({ post, alt }: { post: FeedPost; alt: string }) {
  return isHttps(post.imageUrl) ? (
    // eslint-disable-next-line @next/next/no-img-element -- served by Instagram, not by this site
    <img src={post.imageUrl} alt={alt} referrerPolicy="no-referrer" loading="lazy" className="aspect-square w-full rounded-md border object-cover" />
  ) : (
    <span className="flex aspect-square w-full items-center justify-center rounded-md border bg-muted p-1 text-center text-xs text-muted-foreground">
      {alt || 'No picture'}
    </span>
  )
}

export function FeedSummary({
  feed,
  timeZone = null,
  columns = 'grid-cols-3',
}: {
  feed: InstagramFeedData
  timeZone?: string | null
  /** The grid's Tailwind column classes. */
  columns?: string
}) {
  const { profile, posts } = feed
  const counts = [
    profile.posts === null ? null : `${formatCount(profile.posts)} ${profile.posts === 1 ? 'post' : 'posts'}`,
    profile.followers === null ? null : `${formatCount(profile.followers)} ${profile.followers === 1 ? 'follower' : 'followers'}`,
  ].filter(Boolean)
  const fetched = formatWhen(feed.fetchedAt, timeZone)

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center gap-3">
        <ProfilePhoto url={profile.pictureUrl} username={profile.username} />
        <div className="min-w-0">
          {profile.name ? <p className="truncate font-medium">{profile.name}</p> : null}
          <p className="truncate">
            {isHttps(profile.profileUrl) ? (
              <a href={profile.profileUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                @{profile.username}
                <span className="sr-only"> on Instagram (opens in a new tab)</span>
              </a>
            ) : (
              <>@{profile.username}</>
            )}
          </p>
          {counts.length > 0 ? <p className="text-muted-foreground">{counts.join(' · ')}</p> : null}
        </div>
      </div>

      {posts.length === 0 ? (
        <p className="text-muted-foreground">This account has no posts to show yet.</p>
      ) : (
        <ul className={`grid list-none gap-2 p-0 ${columns}`}>
          {posts.map((post) => {
            const picture = <PostPicture post={post} alt={postAlt(post, timeZone)} />
            return (
              <li key={post.id} className="relative">
                {isHttps(post.permalink) ? (
                  <a
                    href={post.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring"
                  >
                    {picture}
                    <span className="sr-only"> (opens Instagram in a new tab)</span>
                  </a>
                ) : (
                  picture
                )}
                {post.pinned ? <Badge className="pointer-events-none absolute top-1 left-1">Pinned</Badge> : null}
              </li>
            )
          })}
        </ul>
      )}

      {fetched ? <p className="text-muted-foreground">Read from Instagram {fetched}.</p> : null}
    </div>
  )
}
