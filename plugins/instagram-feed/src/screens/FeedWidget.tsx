import { accessPermission, can, host, type PluginUser } from '@pet-adopt/plugin-sdk'
import Link from 'next/link'

import { getConnection, loadInstagramFeed } from '../server'
import { DEFAULT_POSTS, type ConnectionView, type InstagramFeedData } from '../types'
import { FeedSummary } from './FeedSummary'
import { BASE } from './paths'

// The dashboard card: the same feed the block shows (the block's own loader, with the block's
// default number of posts and pinned posts included). It never throws. Without a feed it reads the
// connection to say why: not connected, or connected but the feed not read yet (or its last update
// failed). The dashboard leaves the card out while the plugin's tables are not set up.
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
    let connection: ConnectionView | null = null
    try {
      connection = await getConnection(user)
    } catch {
      // Treated as not connected below.
    }
    if (connection?.connected) {
      return (
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <p>{connection.lastError ? 'Connected, but the last update of the feed failed:' : 'Connected. The feed has not been read yet: try again in a moment.'}</p>
          {connection.lastError ? <p>{connection.lastError}</p> : null}
          <Link href={BASE} className="self-start underline underline-offset-4">
            Open the Instagram screen
          </Link>
        </div>
      )
    }
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
