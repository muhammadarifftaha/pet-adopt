import { accessPermission, can, host, type PluginUser } from '@pet-adopt/plugin-sdk'
import Link from 'next/link'

import { loadInstagramFeed } from '../server'
import { DEFAULT_POSTS, type InstagramFeedData } from '../types'
import { FeedSummary } from './FeedSummary'
import { BASE } from './paths'

// The dashboard card: the same feed the block shows (the block's own loader, with the block's
// default number of posts and pinned posts included). It never throws: a feed that cannot be read
// is drawn as "not connected yet". The dashboard leaves the card out while the plugin's tables are
// not set up.
export async function FeedWidget({ user }: { user: PluginUser }) {
  let feed: InstagramFeedData | null = null
  let timeZone: string | null = null
  try {
    feed = await loadInstagramFeed({ count: DEFAULT_POSTS, pinned: 'include' })
    timeZone = (await host().timeZone()) ?? null
  } catch {
    // Nothing to log here: the loader reports its own failures, and the card falls back below.
  }

  if (!feed) {
    return can(user.role, accessPermission('admin', 'edit')) ? (
      <p className="text-sm text-muted-foreground">
        Not connected yet.{' '}
        <Link href={BASE} className="underline underline-offset-4">
          Connect an Instagram account
        </Link>
        .
      </p>
    ) : (
      <p className="text-sm text-muted-foreground">
        Not connected yet. An admin or a developer can connect an account on the{' '}
        <Link href={BASE} className="underline underline-offset-4">
          Instagram screen
        </Link>
        .
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <FeedSummary feed={feed} timeZone={timeZone} />
      <Link href={BASE} className="self-start underline underline-offset-4">
        {can(user.role, accessPermission('all', 'edit')) ? 'Choose pinned posts' : 'Open the Instagram screen'}
      </Link>
    </div>
  )
}
