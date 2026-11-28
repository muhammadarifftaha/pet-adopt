# Instagram feed

`@pet-adopt/plugin-instagram-feed`: a plugin for [Pet Adopt](https://github.com/muhammadarifftaha/pet-adopt), an open-source storefront for adoptable pets. Show your Instagram profile and its latest posts on the site.

- **Block:** the **Instagram feed** block for the page builder: the profile photo in a circle, the handle, the numbers of posts and followers, the name and the biography, then a grid of square posts and a **Show more** button that opens the profile on Instagram. It follows the site's theme, in light and dark mode.
- **Screen:** **Instagram** in the admin's Plugins menu, to connect the account, pin posts and refresh the feed.
- **Dashboard card:** the same feed on the admin's dashboard.

## What you need

- **An Instagram Business or Creator account.** Instagram's API does not serve personal accounts, so the plugin refuses them. Switching a personal account to a professional one is free, in the Instagram app's settings.
- **A Meta app with the Instagram product and "Instagram login",** made at [developers.facebook.com](https://developers.facebook.com/). Meta asks for a Business type app. It is yours: the plugin has no shared app, and your keys and tokens stay in your site's database.
- **An https address for the site** (`NEXT_PUBLIC_SERVER_URL`), if you connect with the **Connect with Instagram** button: Instagram sends people back to the site, and Meta's apps expect that address to be https. A pasted access token needs no address at all.

## Installing

> **Not published yet:** this package is not on npm yet; it will be published with the first release. In the Pet Adopt repository it is already installed as a workspace package (see [In this repository](#in-this-repository)), so a site cloned from it has steps 1 to 3 done, step 4 happens with the usual `pnpm migrate` (or `pnpm build`), and step 5 is yours to do.

### From npm, in a site

From the site's root folder:

**1. Add the package** to the web app:

```bash
pnpm --filter @pet-adopt/web add @pet-adopt/plugin-instagram-feed
```

`@pet-adopt/plugin-sdk` and `@pet-adopt/ui` are peer dependencies: the plugin uses the site's own copies, which every Pet Adopt site has. So are the packages the web app already installs (`next`, `react`, `react-icons` and `drizzle-orm`).

**2. List the plugin** in `apps/web/pet-adopt.config.ts`: add the import, and add `instagramFeed()` to the list beside the plugins already there.

```ts
import { defineConfig } from '@pet-adopt/plugin-sdk'
import { formBuilder } from '@pet-adopt/plugin-form-builder'
import { instagramFeed } from '@pet-adopt/plugin-instagram-feed'

export default defineConfig({
  plugins: [formBuilder(), instagramFeed()],
})
```

**3. List the block** in `apps/web/pet-adopt.blocks.ts`: add the import, and put `instagramFeedBlock` in the list beside the blocks already there (such as the form builder's `formBlock`). The page builder runs in the browser, so the block is imported from its own entry point, never from the plugin itself:

```ts
import { defineBlocks } from '@pet-adopt/plugin-sdk'
import { formBlock } from '@pet-adopt/plugin-form-builder/block'
import { instagramFeedBlock } from '@pet-adopt/plugin-instagram-feed/block'

export default defineBlocks([formBlock, instagramFeedBlock])
```

Both steps are needed: step 2 gives the screen, the dashboard card and what the block loads; step 3 puts the block in the page builder.

**4. Create its tables.** The plugin has its own database tables.

```bash
pnpm migrate
```

- **A local SQLite file** needs nothing: the tables are made when the site starts.
- **PostgreSQL and hosted libSQL** need `pnpm migrate`. `pnpm build` runs it too.
- **Before migrating:** until it has run, the plugin's screen explains what to run instead of failing, and the block shows nothing.

**5. Allow Instagram's pictures.** Visitors' browsers load the pictures from Instagram's servers. A Pet Adopt site allows pictures from nowhere but itself until you say otherwise, so add Instagram's two picture hosts to the site's settings (`apps/web/.env`, or your host's environment variables):

```bash
CSP_IMG_SRC="https://*.cdninstagram.com https://*.fbcdn.net"
```

- **Restart the site** afterwards: the content security policy is read when the site starts.
- **Without it,** the grid shows empty squares and the browser's console names the blocked address.
- **What it means for visitors:** their browsers contact Instagram's servers to load the pictures, so Instagram sees their address. Say so in your privacy policy.

**The admin screen's styles** need nothing more in a Pet Adopt site: `packages/ui/src/styles/globals.css` already has the line that lets Tailwind read installed `@pet-adopt/plugin-*` packages:

```css
@source "../../../../apps/web/node_modules/@pet-adopt/plugin-*/dist";
```

Without it the screen works but looks unstyled in places.

**Removing the plugin:** take it out of `pet-adopt.config.ts` and its block out of `pet-adopt.blocks.ts` (then, if you like, `pnpm --filter @pet-adopt/web remove @pet-adopt/plugin-instagram-feed`). Its tables and data stay; pages that used the block simply stop showing it. `CSP_IMG_SRC` can go too.

### In this repository

The plugin is the workspace package in `plugins/instagram-feed`, already added to the web app (`pnpm --filter @pet-adopt/web add @pet-adopt/plugin-instagram-feed@workspace:*`) and listed in both `apps/web/pet-adopt.config.ts` and `apps/web/pet-adopt.blocks.ts`. The web app compiles its TypeScript source; `next.config.ts` needs no change, and Tailwind reads it through the `@source "../../../../plugins";` line. Step 4 happens with the usual `pnpm migrate` (or `pnpm build`), and step 5 is still yours to do.

## Connecting an account

Open **Plugins → Instagram** in the admin. Admins and developers can connect and disconnect. The screen offers two ways; use one of them.

The plugin asks Instagram for one permission, `instagram_business_basic`: reading the account's profile and its posts. It never posts, comments or reads messages.

Meta changes its developer dashboard from time to time, so the steps below name what to look for, not every click.

### 1. Your own Meta app (Connect with Instagram)

1. In your Meta app's Instagram settings, find the **Instagram app ID** and the **Instagram app secret**.
2. In the same place, add the address the plugin's screen shows under **Redirect address for the Meta app** (it has a **Copy** button) to the app's list of allowed OAuth redirect addresses. It must match exactly.
3. On the plugin's screen, fill in **App ID** and **App secret** and press **Save keys**. The secret is stored encrypted and never shown again.
4. Press **Connect with Instagram**, sign in as the account you want to show, and allow the app to read its profile and posts. Instagram sends you back to the site, connected.

- **While the Meta app is in development mode,** only accounts with a role on the app (or added as its testers) can sign in. That is enough for your own account.
- **Changing the App ID while an account is connected this way is refused.** Disconnect first: the connection belongs to that app.

### 2. Paste an access token

For when you would rather not enter app keys, or Instagram's sign-in cannot come back to the site (no https address yet, or a site on your own machine):

1. In your Meta app's Instagram settings, add the Instagram account to the app and generate an **access token** for it. At the time of writing this is under the Instagram product's "API setup with Instagram business login".
2. On the plugin's screen, paste it into **Access token** and press **Connect**.

The token is stored encrypted and never shown again. The plugin checks it by reading the account, and refuses a token for a personal account. This way needs no app secret.

### Tokens

- **A token lasts about 60 days,** whichever way you connected. The screen shows the date under **Access expires**.
- **The plugin renews it by itself** when it reads the feed: once the token is a week old, or within 10 days of its end, and at most one try a day. Renewing needs no app secret.
- **A site nobody visits can lose its token.** The feed is only read when a page with the block is shown or someone presses **Refresh now**. If neither happens for 60 days, the token runs out.
- **When it has run out or been withdrawn** (changing the Instagram password does this), the screen shows **Access expired** or the reason. Connect again, or paste a new token.

### Disconnecting

**Disconnect** asks first. It removes the token, the account's details, the saved feed and the pinned posts. Blocks on the site then show nothing, and the pages that use them are not changed. The saved app keys stay.

Connecting a different account also forgets the pinned posts: pins belong to the account.

## The block

Add **Instagram feed** to a page in the page builder. Every part can be shown or hidden.

| Option | What it does |
| --- | --- |
| Heading | An optional heading above the feed |
| Number of posts | 5 to 10 (6 unless you change it) |
| Columns on a wide screen | 2 to 5 (3 unless you change it). Narrow screens use fewer: at most 3 on a phone held sideways or a small tablet, 2 on a small phone |
| Pinned posts | Include them first, or leave them out |
| Profile photo side | Left, as on Instagram, or right |
| Profile photo, Handle, Number of posts on the profile, Number of followers, Name, Biography | Show or hide each |
| Grid of posts | Show or hide |
| Show more button | Show or hide, and its text ("Show more on Instagram" unless you change it) |
| Padding | Top and bottom, like every block |

- **Each square links to the post** on Instagram, in a new tab. Videos and albums carry a small mark, and a video shows its cover picture; nothing plays on your site.
- **Text alternatives:** each picture's is the start of its caption. A post without a caption is described by its date.
- **Large numbers are shortened:** 4,210, then 12.5K, then 1.2M.
- **Before an account is connected,** the block shows a note in the page builder and nothing on the live site.

## Pinned posts

On the plugin's screen, admins and editors can **pin up to 3 posts**. Pinned posts lead the feed, marked "Pinned", and **count towards the block's number of posts**: with 6 posts and 2 pinned, the feed is the 2 pinned and the 4 latest others.

**These are the plugin's own pins.** Instagram's API does not say which posts are pinned on the profile in the Instagram app, so the plugin cannot follow those. Pin the same posts here if you want the two to match.

- **Choosing:** choose posts under **Latest posts**, put them in order with the **Move earlier** and **Move later** buttons, and press **Save pins**.
- **Each block chooses** whether to include them (**Pinned posts** in its options).
- **Only the connected account's own posts** that have a picture can be pinned.

## Privacy

**The pictures come from Instagram's servers.** When a visitor opens a page with the block, their browser fetches the profile photo and the post pictures straight from Instagram (Meta). Instagram therefore sees the visitor's internet address and browser details, as any website they visit does. Mention this in your privacy policy.

What the plugin does to keep that small:

- **No Instagram scripts, cookies or embeds** are loaded: only pictures.
- **No referrer:** the pictures are requested without telling Instagram which page they are on.
- **Nothing more until a click:** the posts and the Show more button are ordinary links that open Instagram in a new tab.
- **Your site talks to Instagram's API from the server only,** with your token. Visitors never see the token.

## Caching

The feed is read from Instagram and kept in the site's database, then **refreshed about once an hour** when a page with the block is shown. Instagram's picture addresses stop working after a while, which is why the feed is refreshed and not kept for long.

- **A new post can take up to an hour to appear.** Press **Refresh now** on the plugin's screen to fetch it at once.
- **If Instagram cannot be reached,** the site keeps showing the last feed it has, and the plugin's screen says what went wrong.
- **The site's pages are cached too** (about a minute), so a refresh can take a moment to show.

## Who can do what

| | Admin | Editor | Developer | Audit |
| --- | --- | --- | --- | --- |
| See the feed, the preview and the pinned posts | Yes | Yes | Yes | Yes |
| See the connection's details (how it was connected, when access expires, the last error) | Yes | No, a short status only | Yes | Yes |
| Pin posts, refresh the feed | Yes | Yes | Yes | No |
| App keys, connect, disconnect | Yes | No | Yes | No |
| Place the block on a page | Yes | Yes | Yes | No |

Changes are recorded in the activity log, naming fields but never keys or tokens. A refresh by hand is recorded too.

## Troubleshooting

Messages in quotes are the ones the plugin shows.

- **The block is not in the page builder:** it is missing from `apps/web/pet-adopt.blocks.ts` (step 3), or the site was not restarted or rebuilt since.
- **The block shows a note that no account is connected:** connect one on the plugin's screen. On PostgreSQL or hosted libSQL, also check that `pnpm migrate` has run.
- **Empty squares where pictures should be:** the content security policy does not allow Instagram's picture hosts (step 5); the browser's console names the blocked address. Restart the site after changing the policy. If only older pictures are missing, press **Refresh now**: their addresses have expired.
- **"Only Business and Creator accounts can be connected.":** it is a personal account. Switch it to a professional account in the Instagram app's settings and connect again.
- **"Instagram did not accept the redirect address.":** the address in your Meta app must be exactly the one on the plugin's screen, including `https://`. It is built from `NEXT_PUBLIC_SERVER_URL`, so check that too.
- **"Instagram did not accept the app secret.":** copy the Instagram app secret again from the Meta app and press **Save keys**.
- **"Instagram refused the request: the app is not allowed to read this account.":** the account is not added to the Meta app, or it did not grant `instagram_business_basic`. While the Meta app is in development mode, add the account as a tester and accept the invitation in Instagram.
- **"That sign-in could not be finished":** the sign-in was not started on this site, was used already, or took longer than 10 minutes. Press **Connect with Instagram** again.
- **"Instagram did not accept this access token.":** generate a new token in the Meta app and paste it again.
- **"Instagram no longer accepts the saved access token":** it expired, or access was removed. Connect again.
- **"The last read from Instagram failed"** on the screen: the site keeps showing the posts it read before. Press **Refresh now**; if it fails again, connect the account again. "Instagram is limiting requests from this app just now" and "Instagram could not be reached" pass by themselves.
- **"The access token could not be renewed":** the plugin tries again the next day. If the message stays, connect again before the date under **Access expires**.
- **The number of followers is missing:** Instagram did not report it for this account; the block leaves out what it was not given.
- **"The saved access token can no longer be read"** or **"The saved app secret can no longer be read":** `BETTER_AUTH_SECRET` changed, and it is the key the site encrypts with. Enter the secret again and connect again.
- **A post cannot be pinned:** only posts of the connected account that have a picture can be pinned, and at most 3.

## What it stores

Two tables of its own, in the site's database (SQLite or PostgreSQL):

| Table | What it holds |
| --- | --- |
| `plugin_instagram_feed_settings` | One row: the app ID, the app secret and the access token (both encrypted), the connected account, which posts are pinned, how the last read from Instagram went, and a sign-in that is under way (only a hash of its one-time code) |
| `plugin_instagram_feed_cache` | One row: the saved feed (the profile and the latest posts, with Instagram's picture addresses) |

It stores no pictures and nothing about visitors.

## For developers

The package on npm is compiled JavaScript with type declarations; files keep their `'use client'` and `'use server'` first lines. The source is in [`plugins/instagram-feed`](https://github.com/muhammadarifftaha/pet-adopt/tree/main/plugins/instagram-feed) in the Pet Adopt repository. [docs/plugins.md](https://github.com/muhammadarifftaha/pet-adopt/blob/main/docs/plugins.md#page-builder-blocks) uses its block as an example of a plugin block.

| File | What it is |
| --- | --- |
| `src/index.tsx` | The plugin: screens, dashboard card, storage, and the block's loader (`blockLoaders`) |
| `src/block.tsx`, `src/block-css.ts` | The block: its options, how it is drawn, and its CSS. Loaded by the browser and drawn on the server, so it has no hooks and imports nothing that needs a server |
| `src/types.ts` | Shared shapes and limits. Pure |
| `src/server.ts` | The rules: the connection, the saved feed, pins, and `loadInstagramFeed` |
| `src/instagram-api.ts` | The calls to Instagram |
| `src/actions.ts` | Server actions for the admin screen. Each checks permission through `host()` |
| `src/storage.ts`, `schema/`, `migrations.ts`, `drizzle/` | Its tables and migrations. The SQL is inlined in `migrations.ts` |
| `src/screens/` | The admin screen and the dashboard card, built with `@pet-adopt/ui` |

**Entry points** (`package.json` `exports`):

| Import | Gives |
| --- | --- |
| `@pet-adopt/plugin-instagram-feed` | The plugin itself (server) |
| `@pet-adopt/plugin-instagram-feed/block` | `instagramFeedBlock`, for `pet-adopt.blocks.ts` |
| `@pet-adopt/plugin-instagram-feed/server` | The rules |
| `@pet-adopt/plugin-instagram-feed/actions` | The server actions |
| `@pet-adopt/plugin-instagram-feed/types` | The shared shapes |

**How the block gets its data:** a block has two halves. `instagramFeedBlock` (browser-safe) declares the options and draws; the plugin's `blockLoaders.InstagramFeed` runs on the server and returns the profile and posts, which reach the block as `data`, on the site and in the page builder's preview. The data is never saved with the page.

**What the block trusts:** nothing saved. Numbers are clamped, a part is hidden only by an exact `hide`, no saved value reaches a class name, all text goes through React, and a link or picture is drawn only for an `https://` address (the server has already checked that addresses are Instagram's own).

**How it talks to the site:** it imports nothing from the app, only [`@pet-adopt/plugin-sdk`](https://github.com/muhammadarifftaha/pet-adopt/tree/main/packages/plugin-sdk) and the site's UI package.

### Working on it in the repository

Inside the Pet Adopt repository the package exports its TypeScript source and the app compiles it.

**After changing its tables:** edit both `schema/sqlite.ts` and `schema/pg.ts`, then run, from the repo root:

```bash
pnpm plugin:generate plugins/instagram-feed <change_name>
```

Commit `drizzle/` and the regenerated `migrations.ts`. Table and index names must start with `plugin_instagram_feed_`, and must not point at the site's own tables.

**Checks:** `pnpm typecheck` and `pnpm lint` cover this package. The end-to-end backend check (`pnpm check:backend` in `apps/web`) answers Instagram's calls with a fake, so it needs no network and no real account.

**Building the package:** `pnpm pack` in this folder compiles `dist/` first (`build:package`) and writes the tarball. [docs/releasing.md](https://github.com/muhammadarifftaha/pet-adopt/blob/main/docs/releasing.md) says how it is published.

## Licence

MIT
