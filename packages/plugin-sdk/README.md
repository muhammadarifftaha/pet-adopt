# @pet-adopt/plugin-sdk

Types and helpers for writing plugins for [Pet Adopt](https://github.com/muhammadarifftaha/pet-adopt), an open-source storefront for adoptable pets.

A plugin can add admin screens, dashboard cards, page builder blocks, its own database tables, default email templates and an email sender. This package is everything a plugin imports: it contains no part of the site itself.

**The full guide to writing a plugin is [in the docs](https://pet-adopt.dev/docs/developers/plugins).**

## Install

List it as a **peer dependency**, so your plugin uses the same copy as the site it is added to, and as a dev dependency to build against:

```json
{
  "peerDependencies": {
    "@pet-adopt/plugin-sdk": "^0.1.0"
  },
  "devDependencies": {
    "@pet-adopt/plugin-sdk": "^0.1.0"
  }
}
```

A plugin that bundles its own copy would have its errors go unrecognised by the site, because they are matched by class.

`react` and `react-icons` are peer dependencies. `drizzle-orm` is one too, and is only needed by a plugin with its own tables.

## A small plugin

```tsx
import { definePlugin } from '@pet-adopt/plugin-sdk'

export const hello = definePlugin(() => ({
  name: 'hello',
  title: 'Hello',
  description: 'Adds one screen to the admin.',
  screens: [
    {
      path: '',
      title: 'Hello',
      nav: { label: 'Hello', Icon: { viewBox: '0 0 24 24', paths: ['M12 2 2 22h20z'], outline: true } },
      component: ({ user }) => <p>Hello {user.name}.</p>,
    },
  ],
}))
```

The site lists it in `apps/web/pet-adopt.config.ts`:

```ts
import { defineConfig } from '@pet-adopt/plugin-sdk'
import { hello } from 'pet-adopt-plugin-hello'

export default defineConfig({ plugins: [hello()] })
```

## Page builder blocks

A block has two halves. The block itself (`definePluginBlock`: its name, options and how it is drawn) is loaded by the browser, so it lives in a module of its own that imports nothing server-only, and a site lists it in `apps/web/pet-adopt.blocks.ts`:

```ts
import { defineBlocks } from '@pet-adopt/plugin-sdk'
import { helloBlock } from 'pet-adopt-plugin-hello/block'

export default defineBlocks([helloBlock])
```

Its loader (`blockLoaders` on the plugin) runs on the server and returns what the block shows. Blocks are styled with plain CSS on the site's theme variables (`var(--primary)`, `var(--surface)`, `var(--radius)`...), because the public site does not load Tailwind; start every selector with a class of your own.

## What is in it

- **`definePlugin`, `defineConfig`:** declare a plugin and a site's list of plugins.
- **`definePluginBlock`, `defineBlocks`:** page builder blocks and a site's list of them.
- **`definePluginStorage`:** a plugin's own tables and migrations, for SQLite and PostgreSQL. Table names start with the plugin's prefix (`pluginTablePrefix`).
- **`host()`:** the site's services: permission checks, rate limits, templated email, the activity log, encrypted secrets, the privacy policy, the site's address and time zone.
- **Roles and permissions:** `ROLES`, `can`, `accessPermission`.
- **Errors and results:** `UserError`, `ValidationError`, `ActionResult`.
- **Helpers:** `formatWhen` and the time zone functions, `foldText` for search, `csvCell` for safe CSV.

## Rules for plugins

- **Depend only on this package** (and the site's UI package, `@pet-adopt/ui`, for admin screens). Never import the site.
- **Check permissions in every server action** with `host().requirePermission(...)`, wrapped in `host().run(...)`.
- **Log errors with `host().logError`,** never the error object: a database error can carry the values it was given.
- **Ship compiled JavaScript** when you publish a plugin to npm, and keep `'use client'` and `'use server'` as the first line of the files that have them (plain `tsc`, file by file, does). The guide says how.

Two plugins published from the repository show a full plugin: [`@pet-adopt/plugin-form-builder`](https://github.com/muhammadarifftaha/pet-adopt/tree/main/plugins/form-builder) and [`@pet-adopt/plugin-instagram-feed`](https://github.com/muhammadarifftaha/pet-adopt/tree/main/plugins/instagram-feed). [`adoption-tips`](https://github.com/muhammadarifftaha/pet-adopt/tree/main/plugins/adoption-tips) is a small example to copy (not on npm).

## Versions

The package is below 1.0, so a minor version may change the API. Pin the minor version you built against.

## Licence

MIT
