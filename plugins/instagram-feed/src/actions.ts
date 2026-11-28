'use server'

// The Instagram feed plugin's server actions: what its admin screens and dashboard card call. Each
// one checks who is calling through `host()`, takes untrusted input, and returns an ActionResult.
// The rules live in ./server.ts.
//
// Who may do what: the connection (keys, connecting, disconnecting) is `admin` access (admins and
// developers change it, audit views it); the feed and its pins are `all` (editors too).
//
// Changes go into the site's activity log with host().recordActivity after they succeed: field
// names only, never a key, a token or a value.
import { accessPermission, host, type ActionResult } from '@pet-adopt/plugin-sdk'

import {
  completeAuthorization,
  connectWithToken,
  disconnect,
  getConnection,
  getFeedPreview,
  getPinnedIds,
  listRecentPosts,
  refreshFeed,
  saveAppKeys,
  setPinnedPosts,
  startAuthorization,
} from './server'
import type { ConnectionView, FeedPost, InstagramFeedData } from './types'

const MINUTE = 60_000
/** Per person: starting Instagram's sign-in. */
const AUTHORIZE_RULE = { max: 20, windowMs: 15 * MINUTE }
/** Per person: finishing a sign-in or pasting a token (each one calls Instagram). */
const CONNECT_RULE = { max: 10, windowMs: 15 * MINUTE }
/** Per person: "Refresh now". */
const REFRESH_RULE = { max: 6, windowMs: 10 * MINUTE }
/** Per person: changing the pins (an older post is confirmed with Instagram). */
const PINS_RULE = { max: 30, windowMs: 10 * MINUTE }

const asRecord = (input: unknown): Record<string, unknown> => (input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {})
const handle = (view: ConnectionView) => (view.account ? `@${view.account.username}` : 'an Instagram account')

// --- The connection (admins and developers; audit views) ----------------------------------------

export async function getConnectionAction(): Promise<ActionResult<ConnectionView>> {
  return host().run(async () => {
    const user = await host().requirePermission(accessPermission('admin', 'view'))
    return getConnection(user)
  })
}

/** `{ appId, appSecret?, clearSecret? }`: a blank secret keeps the saved one. */
export async function saveAppKeysAction(input: { appId: string; appSecret?: string; clearSecret?: boolean }): Promise<ActionResult<ConnectionView>> {
  return host().run(async () => {
    const user = await host().requirePermission(accessPermission('admin', 'edit'))
    const { view, changed } = await saveAppKeys(user, input as unknown)
    if (changed.length) await host().recordActivity({ action: 'instagram-feed.keys.update', summary: 'Changed the Instagram app keys', fields: changed })
    return view
  })
}

/** The address to send the browser to, to sign in to Instagram and allow the app. */
export async function startAuthorizationAction(): Promise<ActionResult<{ url: string }>> {
  return host().run(async () => {
    const user = await host().requirePermission(accessPermission('admin', 'edit'))
    await host().consumeAttempt(`instagram-feed:authorize:${user.id}`, AUTHORIZE_RULE)
    const started = await startAuthorization(user)
    await host().recordActivity({ action: 'instagram-feed.account.authorize', summary: 'Started connecting an Instagram account' })
    return started
  })
}

/** `{ code, state }` as Instagram sent them back to the callback screen. */
export async function completeAuthorizationAction(input: { code: string; state: string }): Promise<ActionResult<ConnectionView>> {
  return host().run(async () => {
    const user = await host().requirePermission(accessPermission('admin', 'edit'))
    await host().consumeAttempt(`instagram-feed:connect:${user.id}`, CONNECT_RULE)
    const view = await completeAuthorization(user, input as unknown)
    host().revalidateSite()
    await host().recordActivity({ action: 'instagram-feed.account.connect', summary: `Connected the Instagram account ${handle(view)}`, fields: ['account', 'access token'] })
    return view
  })
}

/** `{ token }`: an access token made in the Meta app dashboard. */
export async function connectWithTokenAction(input: { token: string }): Promise<ActionResult<ConnectionView>> {
  return host().run(async () => {
    const user = await host().requirePermission(accessPermission('admin', 'edit'))
    await host().consumeAttempt(`instagram-feed:connect:${user.id}`, CONNECT_RULE)
    const view = await connectWithToken(user, asRecord(input).token)
    host().revalidateSite()
    await host().recordActivity({
      action: 'instagram-feed.account.connect',
      summary: `Connected the Instagram account ${handle(view)} with an access token`,
      fields: ['account', 'access token'],
    })
    return view
  })
}

export async function disconnectAction(): Promise<ActionResult<ConnectionView>> {
  return host().run(async () => {
    const user = await host().requirePermission(accessPermission('admin', 'edit'))
    const before = await getConnection(user)
    const view = await disconnect(user)
    if (before.connected) {
      host().revalidateSite()
      await host().recordActivity({ action: 'instagram-feed.account.disconnect', summary: `Disconnected the Instagram account ${handle(before)}`, fields: ['account', 'access token', 'pinned posts'] })
    }
    return view
  })
}

// --- The feed and its pins (the whole team) -----------------------------------------------------

/** Reads the feed from Instagram now. Null when no account is connected. */
export async function refreshFeedAction(): Promise<ActionResult<InstagramFeedData | null>> {
  return host().run(async () => {
    const user = await host().requirePermission(accessPermission('all', 'edit'))
    await host().consumeAttempt(`instagram-feed:refresh:${user.id}`, REFRESH_RULE)
    const feed = await refreshFeed()
    if (feed) {
      host().revalidateSite()
      await host().recordActivity({ action: 'instagram-feed.feed.refresh', summary: 'Refreshed the Instagram feed' })
    }
    return feed
  })
}

/** The latest posts, for choosing pins: pinned ones first, with `pinned` set. */
export async function listRecentPostsAction(): Promise<ActionResult<FeedPost[]>> {
  return host().run(async () => {
    await host().requirePermission(accessPermission('all', 'view'))
    return listRecentPosts()
  })
}

/** `{ ids }`: the posts that lead the feed, in order; at most MAX_PINNED. An empty list unpins all. */
export async function setPinnedPostsAction(input: { ids: string[] }): Promise<ActionResult<FeedPost[]>> {
  return host().run(async () => {
    const user = await host().requirePermission(accessPermission('all', 'edit'))
    await host().consumeAttempt(`instagram-feed:pins:${user.id}`, PINS_RULE)
    const before = await getPinnedIds()
    const posts = await setPinnedPosts(asRecord(input).ids)
    const after = await getPinnedIds()
    if (before.join() !== after.join()) {
      host().revalidateSite()
      await host().recordActivity({
        action: 'instagram-feed.pins.update',
        summary: after.length ? `Pinned ${after.length} Instagram ${after.length === 1 ? 'post' : 'posts'} to the start of the feed` : 'Unpinned every Instagram post',
        fields: ['pinned posts'],
      })
    }
    return posts
  })
}

/** The feed as a block shows it at most: MAX_POSTS posts, pinned ones first. Null when there is none. */
export async function getFeedPreviewAction(): Promise<ActionResult<InstagramFeedData | null>> {
  return host().run(async () => {
    await host().requirePermission(accessPermission('all', 'view'))
    return getFeedPreview()
  })
}
