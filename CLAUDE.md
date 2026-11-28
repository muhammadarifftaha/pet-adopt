# Pet Adopt: notes for Claude Code

Open-source storefront for adoptable pets. Visitors browse a catalogue and contact the owners on WhatsApp or social media. There are no visitor accounts. Only the team signs in, adds pets, and builds pages with a drag-and-drop editor.

The README describes the features and the setup; `SECURITY.md` says how to report a vulnerability and how to run a site safely. This file holds what an assistant needs to work in the code.

## Stack

Next.js (app router), React, TypeScript, Drizzle ORM (SQLite through libSQL, or PostgreSQL), Better Auth, Puck for the page and email builders, shadcn/ui on Tailwind. Versions are pinned on purpose: check `package.json` before assuming an API.

## Layout (pnpm workspace + Turborepo)

- `apps/web`: the Next.js app, backend included (`src/`, `scripts/`, `drizzle/`, `pet-adopt.config.ts`, `.env`).
  - `src/app`: routes. `(frontend)` is the public site, `(admin)` the admin, `(editor)` the builders.
  - `src/db`: the schema (one file per database, kept as twins), the client and migrations.
  - `src/server`: the data layer and its rules; `src/server/actions` holds the server actions the UI calls.
  - `src/puck`: the builder's blocks and their checks.
  - `src/plugins`: the plugin registry and runtime.
- `apps/docs`: the documentation site (Fumadocs). Pages are MDX in `content/docs/`, in two sections: `admin/` (running a site) and `developers/`. Update the page when you change what it describes.
- `packages/ui` (`@pet-adopt/ui`): shadcn components and the shared CSS.
- `packages/plugin-sdk` (`@pet-adopt/plugin-sdk`): everything a plugin imports. It imports nothing from the app.
- `plugins/*`: workspace plugins. Each depends only on the SDK.

## Commands

Use **pnpm** only. From the repository root:

- `pnpm dev`, `pnpm build`
- `pnpm typecheck`, `pnpm lint`: run both before finishing a change.
- `pnpm check:schemas`: fails when the two database schemas drift apart.
- `pnpm check:backend`: end-to-end checks of the data layer. Its script header lists what it needs; run it on SQLite and PostgreSQL after a data-layer change.
- `pnpm db:generate`, `pnpm migrate`, `pnpm seed`
- Add a dependency with `pnpm --filter <package> add <name>`, never at the root.

## Rules to keep

- **Schema changes:** edit both schema files, run `pnpm db:generate`, then `pnpm check:schemas` and `pnpm check:backend`. Keep columns portable between the two databases.
- **Server actions:** every exported action starts by checking a permission, validates its input, and returns an `ActionResult`. An action that changes something records it in the activity log. `check:backend` enforces both.
- **Errors:** never log an error object from the data layer; use the logging helpers in `src/server/result.ts`.
- **Transactions:** use `withTransaction` from `src/db/client.ts`, not Drizzle's own.
- **Anything a person can type that ends up in a page** (links, embeds, rich text, block options, theme values) goes through the existing validators and sanitisers. Do not render stored values as HTML or put them into class names unchecked.
- **Anything the server connects to because someone typed an address** follows the existing checks for those settings. Read them before adding another.
- **Uploads** are raster images only, stored in S3-compatible object storage. Keep code and docs provider-neutral.
- **Plugins** never import the app, and their tables carry the plugin's prefix.
- **UI:** the admin uses `@pet-adopt/ui` and Tailwind; the public site uses plain CSS driven by theme variables. Every colour, radius, font and spacing value is a variable.
- **Accessibility:** WCAG 2.2 AA. Every control has a visible label, errors are tied to their fields, and nothing depends on drag alone.

## Conventions

- **Branch names** are `<type>/<topic>`: `feat/`, `fix/`, `hotfix/`, `chore/`, `docs/`, `refactor/`, then a short topic in lowercase with dashes.
- Scripts live in `apps/web/scripts`, run with `tsx`, and load `.env` only through the package scripts.
- CI actions are pinned to commit SHAs; pin any new one the same way.
- Maintainers may keep longer working notes in `.claude/`, which is git-ignored.
