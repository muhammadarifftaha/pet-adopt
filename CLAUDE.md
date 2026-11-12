# Pet Adopt: notes for Claude Code

Open-source storefront for adoptable pets. Visitors browse a catalog and contact the owners on WhatsApp or social media. No visitor accounts. Only the owners sign in, add pets, and build pages with a drag-and-drop editor.

Stack (versions pinned on purpose): Next.js 16.3.3, Payload CMS 3.93.0, Puck (`@puckeditor/core` ^0.24, formerly `@measured/puck`), React 19.2, TypeScript 5.7. Plain CSS, no Tailwind.

## Handoff: where things stand

The first version was scaffolded in a Linux sandbox. The following all passed there:

- `pnpm exec tsc --noEmit` and `pnpm lint`.
- `pnpm build`, including with **no database present** (a fresh CI or Docker build).
- `next dev` and `next start` against a seeded SQLite DB. `/`, `/pets`, `/pets?species=dog&status=`, `/pets/mochi`, `/about`, a 404 and `/health` rendered the right content. WhatsApp links, Open Graph tags and the 307 redirect for unauthenticated `/edit/1` were correct.
- Access control: anonymous `POST /api/pets` returns 403, and anonymous reads of `/api/pages` see only published pages.
- Draft vs. publish via the local API: a draft save leaves the published version untouched, and publishing promotes it.
- An owner can upload media through `POST /api/media`.

**Never exercised in a real browser** (do this first):

1. Puck editor at `/edit/[id]`: drag blocks, edit fields, **Save draft**, **Publish**, "Page settings" and "View live" links, and whether the saved JSON matches what was on screen.
2. The media picker field (choose existing, upload new with alt text, remove).
3. The PetGrid block in the editor: it should show live pets (`resolveData` calls `fetchPetsAction`), and the saved JSON must **not** contain a `pets` prop.
4. The **Open page builder** button on the Pages edit screen in `/admin` (custom component in `src/components/admin/OpenBuilder.tsx`, wired through the generated import map).
5. Layout and styling on mobile widths, which no one has looked at yet.

**Not tested at all:** PostgreSQL (`DATABASE_URL=postgres://...`, `docker-compose.yml`), Payload migrations, and S3 or R2 uploads (`S3_*` env vars).

## First steps on the user's Mac

`pnpm install` has been run on the Mac and typecheck, lint and `pnpm build` pass there. `.env` does not exist yet:

```bash
cp .env.example .env
```

Then set `PAYLOAD_SECRET` and `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` in `.env`, and run `pnpm seed` and `pnpm dev`. The server creates the owner from `SEED_ADMIN_*` on startup when no user exists (`src/lib/ensureOwner.ts`).

## Review and hardening done on 2026-11-12

Three read-only reviews (security, model design, database) were run, then these were applied and checked with a throwaway-SQLite script (16 checks passed):

- **Config** (`src/payload.config.ts`): production refuses to start without a 32+ char `PAYLOAD_SECRET` and `NEXT_PUBLIC_SERVER_URL`; CSRF/CORS limited to that URL; GraphQL disabled (route files deleted); `maxDepth: 3`; 10 MB upload limit; Postgres `push: false` with pool settings and `migrationDir`; S3 credentials required when `S3_BUCKET` is set.
- **Users:** lockout, 2h sessions, `secure` cookie in production, the last user cannot be deleted. `onInit` seeds the first owner from env.
- **Media:** no SVG; deleting an image used by a pet (`photos`) or page (`seo.image`) is refused.
- **Pets:** slug generated in `beforeValidate`, kept on partial updates, validated against `SLUG_PATTERN`, non-Latin names get `pet-<id>`. The slug field is deliberately **not** `required`, because the admin form would block blank slugs before the hook runs. Any change refreshes the whole site (`['/', 'layout']`).
- **Pages:** `drafts.validate: true`, `puckData` validated with `isPuckData`, transient props stripped in `beforeChange`.
- **Links and settings:** `safeHref` rejects `//host` and `/\host`; social URLs and menu links are validated and rendered through `safeHref`; the WhatsApp number is validated; `(0)` trunk prefixes are dropped.
- **Queries and indexes:** `pets` has indexes on `status`, `species`, `featured` and a compound `status, createdAt` (plus Payload's own `createdAt`); the duplicate `index: true` next to `unique: true` slugs is gone. Catalog and grid queries `select` only the card fields, sort `['-createdAt', '-id']`, and `populate` media with `url, alt, filename, updatedAt`: Payload builds `url` from `filename`, so leaving `filename` out makes every image url `null`. `queryPetCards` (no paging, no COUNT) feeds the Puck grid. The location filter uses `contains` with LIKE wildcards stripped.
- **Postgres migration:** `src/migrations/20261112_051637_initial.*` was generated against the compose Postgres and checked: `pnpm migrate` on an empty database, `migrate:down` (drops everything) and `migrate` again all work; the seed and the catalog queries pass on Postgres. `pnpm migrate:create <name>` is needed after every model change, and the generated `.ts` files trigger ESLint warnings (unused `payload`/`req`) that the config-protection hook would not let me ignore in `eslint.config.mjs`. The compose database `pet_adopt` was migrated and seeded with the samples (no owner); `.env` still points at SQLite.
- **Pet details** (`src/collections/Pets.ts`): the admin form is split into tabs (Basics, Health and behaviour, Photos and story, Adoption) next to the sidebar fields. Tabs are layout only, so existing columns kept their names. New fields: `urgent` (sidebar), `birthDate`, `color`, `microchipped`, `houseTrained`, `specialNeeds`, `healthNotes`, `temperament` and `goodWith` (multi-selects from `TEMPERAMENTS` and `GOOD_WITH` in `options.ts`), `videoUrl` (https only), `adoptionFee` (>= 0), `rescuedAt`, `contactWhatsApp` (validated number). Limits: name 60 characters, age text 40, up to 10 photos. Migration `add_pet_details` only adds columns and two multi-select tables.
- **Unlisted pets** (`unlisted` checkbox in the `pets` sidebar): link-only visibility. `buildWhere` in `queries.ts` always adds `unlisted != true`, so the catalog and Puck grids never show them; `getPetBySlug` ignores the flag, so the direct link opens the page, which sets `robots: noindex`. The collection `read` access returns `{ unlisted: { not_equals: true } }` for visitors and everything for signed-in owners, so `/api/pets` and `/api/pets/:id` hide them too. The public pages use the Local API, which skips access rules: any new public listing query must add the filter itself. Migration `add_pet_unlisted` adds one boolean column. Verified with 14 checks over the Local API, access rules and HTTP.
- **CSP** (`next.config.ts`): sent on every route. `default-src 'self'`; scripts and styles allow `'unsafe-inline'` (Next and Payload emit inline bootstrap scripts, and a nonce would force per-request rendering and end the `revalidate` caching), plus `'unsafe-eval'`, `ws:` and `wss:` in development only; `img-src 'self' data: blob:`; `frame-src https://www.google.com/maps/` (the Contact block's `safeMapEmbed`); `object-src 'none'`, `base-uri`, `form-action` and `frame-ancestors` limited to self; `upgrade-insecure-requests` only when `NEXT_PUBLIC_SERVER_URL` is https. `CSP_REPORT_ONLY=1` switches to the report-only header. `headers()` is read at startup and baked in at build, so restart `next dev` after changing it. Checked on a production build: `/`, `/pets`, `/pets/mochi`, `/about` and `/admin/login` produce no console violations; an outside script, fetch, image and iframe are blocked, `eval` throws, and a Google Maps iframe is allowed. New external resources (analytics, fonts, embeds, S3 image URLs) need a directive added there. The admin avatar is set to `'default'` in `payload.config.ts`: Payload's default loads gravatar.com images, which the CSP blocked (found while the user clicked through the signed-in admin) and which would leak a hash of the owner's email.
- **Seed** (`scripts/seed.ts`): each step checks before it writes, so re-running is safe and finishes a partial run. It adds no pets if any non-sample pet exists, only fills site settings while they are still the defaults, skips an existing `about` page, deletes a sample's picture if its pet fails to save, and refuses to run when `NODE_ENV=production` unless `SEED_FORCE=1`.
- **Ops:** security headers in `next.config.ts`, Postgres bound to `127.0.0.1` in `docker-compose.yml`, `migrate` and `migrate:create` scripts, seed renders PNG placeholders instead of SVG.

## Suggested next steps

- [ ] Browser-test the editor as listed above and fix whatever breaks. The user plans to build the UI elements themself.
- [ ] Show the new pet fields on the public pet page and cards (`birthDate`, `color`, `microchipped`, `houseTrained`, `specialNeeds`, `healthNotes`, `temperament`, `goodWith`, `videoUrl`, `adoptionFee`, `rescuedAt`, `contactWhatsApp`, `urgent`). The model, types, migration and seed have them; the user is building that UI themself. `contactWhatsApp` should override the site number on that pet's WhatsApp button.
- [ ] Remaining model improvements from the review: structured city and state, pet SEO fields, a roles field on `Users`.
- [ ] Optional: show an "Unlisted" or "Urgent" badge on pet cards and the pet page (the user is building the UI). Unlisted pets are not in the catalog, grids or sitemap-style listings, so any new listing query must go through `buildWhere` in `src/lib/queries.ts`.
- [ ] Click through the signed-in admin (pets, pages, media upload, site settings) and the Puck editor with DevTools open, or with `CSP_REPORT_ONLY=1`, to confirm the CSP blocks nothing they need. Only the public pages and the login page were checked.
- [ ] Delete the stray `.env.example.bak` (identical to the old `.env.example`).
- [ ] The repo already has a `.git` directory (the earlier handoff said it did not): check `git status`, then commit. Confirm the copyright holder in `LICENSE` (currently "pet-adopt contributors").
- [ ] Optional: Dockerfile, a one-click deploy setup, a Columns block (Puck slots), nested page slugs, a mobile-width preview in the editor.
- [ ] Delete this "Handoff" section once it is done.

## Architecture

- **Routes:** `src/app/(frontend)` is the public site (`/`, `/pets`, `/pets/[slug]`, `/[slug]`). `src/app/(editor)/edit/[id]` is the Puck editor, auth-gated. `src/app/(payload)` is Payload's admin and API. `/health` is a liveness probe.
- **Data:** collections `pets`, `pages`, `media`, `users` and the global `site-settings` live in `src/collections` and `src/globals`. Shared select options are in `src/lib/options.ts`.
- **Database:** `DATABASE_URL` starting with `postgres://` selects Postgres, anything else (default `file:./pet-adopt.db`) selects SQLite. See `src/payload.config.ts`. Setting `S3_BUCKET` enables S3-compatible uploads.
- **Pages:** one `pages` collection with Payload drafts. The Puck JSON lives in the hidden `puckData` field. The slug `home` is the homepage. Reserved slugs are in `RESERVED_SLUGS`. Public reads return published versions only. If no `home` page is published, `DEFAULT_HOME_DATA` in `src/puck/data.ts` is shown.
- **Puck blocks:** all in `src/puck/config.tsx`. The same components render on the server for visitors (`Render` and `resolveAllData` from `@puckeditor/core/rsc`, see `BuilderContent.tsx`) and inside the editor.
  - Blocks must stay free of hooks and browser-only code.
  - Blocks read site settings and fetch live pets through Puck's `metadata` (`PuckSiteMetadata` in `src/puck/types.ts`). On the server `fetchPets` queries Payload directly. In the editor it is the server action `fetchPetsAction`.
  - `pets` on PetGrid is a transient prop filled by `resolveData`. `stripTransient` removes it before anything is saved. Add any new resolved prop to `TRANSIENT_PROPS` in `src/puck/data.ts`.
  - The editor runs with `iframe: { enabled: false }` so the real site CSS applies. The cost is that media queries don't emulate mobile.
- **Caching:** public pages use `revalidate = 60` plus on-demand `revalidatePath` from collection and global hooks (`safeRevalidate` swallows errors outside a request, e.g. in the seed script). `[slug]` and `pets/[slug]` return an empty `generateStaticParams`, so pages render on first visit.
- **Build without a DB:** `safely()` in `src/lib/queries.ts` returns fallbacks only while `NEXT_PHASE` is the production build. At runtime, errors surface.

## Gotchas

- `payload run <script>` exits as soon as the module finishes evaluating. Scripts need **top-level `await`**; a bare `main().catch()` silently does nothing. See `scripts/seed.ts`.
- After changing collections or globals, run `pnpm generate:types`. After adding or moving a Payload admin component, run `pnpm generate:importmap`. Both outputs (`src/payload-types.ts`, `src/app/(payload)/admin/importMap.js`) are committed.
- Postgres never auto-syncs its schema (`push: false`). Use `pnpm migrate:create` and `pnpm migrate`; SQLite still pushes in development. Until `migrate` has run, `ensureOwner` logs an error and skips instead of crashing.
- `payload.config.ts` throws in production (not during `next build`, which is detected through `NEXT_PHASE`) when `PAYLOAD_SECRET` is weak or `NEXT_PUBLIC_SERVER_URL` is missing. Do not set Payload's `serverURL`: it turns `media.url` absolute and breaks the relative `next/image` patterns.
- The admin form validates before server hooks run, so a field cannot be both `required` and auto-filled by a hook.
- Uploads must be raster images. Do not add SVG back to `Media.mimeTypes`.
- Scripts run with `payload run` that live outside the project folder fail ("top-level await" with cjs); keep them under `scripts/`.
- Puck fields typed with `as Fields<Props>` are deliberate: the `pets` prop is render-only and has no editor field.
- The admin uses Payload defaults. Uploads default to `./media` (gitignored), which is fine on a VPS but not on serverless hosts.
- Seeded content: the WhatsApp number `0120000000` is a placeholder, and the pet photos are generated PNG placeholders.

## Conventions

- Keep it simple: plain CSS in `src/app/(frontend)/styles.css`, the theme colour comes from the `--primary` variable set in the layout from Site settings.
- Only allow safe links and embeds: use `safeHref` and `safeMapEmbed` from `src/lib/links.ts` for anything an owner can type into a block.
- Use **pnpm** only (`pnpm install`, `pnpm dev`, `pnpm exec <bin>`); the npm lockfile was removed and `pnpm-lock.yaml` is the source of truth. Do not run `npm install`, which would recreate `package-lock.json`.
- Run `pnpm typecheck` and `pnpm lint` before finishing a change.
