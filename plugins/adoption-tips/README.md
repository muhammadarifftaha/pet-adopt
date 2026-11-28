# Adoption tips (example plugin)

`@pet-adopt/plugin-adoption-tips`: a small example of a Pet Adopt plugin. It adds a **Tips** screen to the admin and a tip card to the dashboard. It is not published to npm: it stays in this repository as an example. Copy it as a starting point for your own plugin (the [plugin guide](../../docs/plugins.md) explains how); for a full one, with its own database tables, server actions and email, see [`plugins/form-builder`](../form-builder).

## What it adds

- **A Tips screen** at `/admin/plugins/adoption-tips`, with a **Tips** entry in the admin's Plugins menu.
- **A second screen** at `/admin/plugins/adoption-tips/tips/<id>`, showing how a screen takes a parameter from its address (`params.id`).
- **A dashboard card,** "Tip of the day".

## Turning it on or off

It's listed in `apps/web/pet-adopt.config.ts`:

```ts
import { adoptionTips } from '@pet-adopt/plugin-adoption-tips'

export default defineConfig({
  plugins: [adoptionTips({ heading: 'Tips for new owners' })],
})
```

**Options:** `heading`, the title of the screen and card (default "Adoption tips"). To remove the plugin, delete it from `plugins`.

## How it is made

Everything is in [`src/index.tsx`](src/index.tsx). A plugin is `definePlugin(...)` from `@pet-adopt/plugin-sdk`, returning:

| Key | What it does |
| --- | --- |
| `name` | The plugin's name: part of its addresses (`/admin/plugins/<name>`), and the prefix for its activity log entries and database tables |
| `title`, `description` | Shown on the admin's list of plugins |
| `screens` | Admin screens. `path: ''` is the plugin's home; `nav: { label, Icon }` puts it in the menu; `:id` in a path becomes `params.id` |
| `dashboardWidgets` | Cards on the admin dashboard, each with an `id`, `title` and `component` |

**Screens and cards:**
- **Rendering:** they're server components. They can be `async`, and receive the signed-in `user` (plus `params` and `searchParams` for screens). For anything interactive, render a `'use client'` component.
- **Components:** build them with `@pet-adopt/ui`, the same shadcn components the admin uses.

**Who sees what:** a screen or card can set `access`:
- `'all'` (the default): everyone signed in;
- `'admin'`: admins and developers;
- `'personalData'`: admins and editors, with audit read-only.

**Menu icons:** a react-icons icon (as here), or SVG path data such as `{ viewBox: '0 0 24 24', paths: ['M12 2 2 22h20z'], outline: true }`.

**What a plugin can do beyond this:**
- **Its own tables:** `storage` with `definePluginStorage`, migrations made by `pnpm plugin:generate`, and names starting with `plugin_<name>_`.
- **Default email templates:** `emailTemplates`.
- **Site services through `host()`:** permission checks, rate limits, sending templated email, the activity log, encrypted secrets, and the site's privacy policy.

The form builder uses all of them.

## Rules for plugins

- **Depend only on the SDK.** Import `@pet-adopt/plugin-sdk` (and `@pet-adopt/ui` for screens), never the app, so the plugin works from npm as well as from this repo.
- **Check permissions in every server action** with `host().requirePermission(...)`, wrapped in `host().run(...)`.
- **Log errors with `host().logError`,** never the error object: a database error can carry the values it was given.
- **Workspace plugins ship TypeScript,** and the app compiles them. A plugin published to npm should ship compiled JavaScript.

To add a new workspace plugin to the site:
1. Run `pnpm --filter @pet-adopt/web add <name>@workspace:*` from the repo root.
2. List the plugin in `apps/web/pet-adopt.config.ts`.

`pnpm typecheck` and `pnpm lint` cover this package.
