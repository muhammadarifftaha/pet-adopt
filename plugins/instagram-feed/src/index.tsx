import { FiInstagram } from 'react-icons/fi'

import { definePlugin } from '@pet-adopt/plugin-sdk'

import { AuthorizationCallback } from './screens/AuthorizationCallback'
import { FeedWidget } from './screens/FeedWidget'
import { InstagramHome } from './screens/InstagramHome'
import { loadInstagramFeed } from './server'
import { instagramFeedStorage } from './storage'
import { BLOCK_NAME, INSTAGRAM_FEED } from './types'

export { instagramFeedStorage } from './storage'
export * from './types'

// Instagram feed. Adds an "Instagram feed" block to the page builder: a business or creator
// account's profile and its latest posts. A plugin with its own tables (schema/, migrations.ts,
// src/storage.ts): adding it to a running site needs `pnpm migrate` (PostgreSQL) before its screens
// work; until then they show a notice.
//
// This module is the server half: screens, the dashboard card and the block's loader. The block
// itself (src/block.tsx) is loaded by the browser, so it is NOT exported from here: a site lists it
// in `pet-adopt.blocks.ts` from `@pet-adopt/plugin-instagram-feed/block`.
//
// Storage: src/storage.ts. Rules: src/server.ts (the connection, the cached feed, pins). Calls to
// Instagram: src/instagram-api.ts. Server actions: src/actions.ts. Shared shapes: src/types.ts.
// Admin screens: src/screens (built on @pet-adopt/ui).

export const instagramFeed = definePlugin({
  name: INSTAGRAM_FEED,
  title: 'Instagram feed',
  description: 'Show an Instagram business or creator account and its latest posts on the site, as a block in the page builder.',
  storage: instagramFeedStorage,
  // What the block shows, loaded on the server wherever the block is drawn.
  blockLoaders: { [BLOCK_NAME]: loadInstagramFeed },
  screens: [
    {
      path: '',
      title: 'Instagram feed',
      nav: { label: 'Instagram', Icon: FiInstagram },
      // Everyone on the team sees the feed and editors pin posts; the connection part of the
      // screen is for admins and developers (audit views it), checked inside.
      component: ({ user }) => <InstagramHome user={user} />,
    },
    {
      path: 'callback',
      title: 'Connect Instagram',
      // Where Instagram sends the browser back after its sign-in. Connecting is for admins and developers.
      access: 'admin',
      hidden: true,
      component: ({ searchParams, user }) => <AuthorizationCallback searchParams={searchParams} user={user} />,
    },
  ],
  dashboardWidgets: [
    {
      id: 'feed',
      title: 'Instagram feed',
      component: ({ user }) => <FeedWidget user={user} />,
    },
  ],
})
