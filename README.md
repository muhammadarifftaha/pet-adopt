# Pet Adopt

An open-source storefront for adoptable pets, built for rescuers, shelters and pet businesses.

Visitors browse a catalog and contact you on **WhatsApp** or social media. There are no visitor accounts or checkout. The owners sign in, add pets, and design pages with a drag-and-drop **page builder**.

- **Catalog and pet pages:** filterable by species, age, sex, size, status and location. Filters live in the URL, so any search can be shared.
- **WhatsApp-first:** every pet page has a click-to-chat button with a prefilled message.
- **Page builder:** the homepage and any extra page (About, FAQ, Events...) are composed from built-in blocks with [Puck](https://puckeditor.com).
- **Owner admin:** pets, photos, pages and site settings are managed in [Payload CMS](https://payloadcms.com).
- **Fast and SEO-friendly:** server-rendered, cached pages, Open Graph previews for WhatsApp and Instagram shares.

Built with Next.js, Payload CMS and Puck. All MIT-licensed.

## Quick start

Requires Node.js 22.23.4 or newer (or 24.22.1+) and [pnpm](https://pnpm.io). The project is installed and run with pnpm only; there is no npm lockfile.

```bash
git clone <your-fork-url> pet-adopt
cd pet-adopt
cp .env.example .env
pnpm install
pnpm seed      # optional: sample pets and an About page
pnpm dev
```

Open <http://localhost:3000>.

Local development uses a SQLite file (`pet-adopt.db`), so there is nothing else to install. Set `PAYLOAD_SECRET` in `.env` to a long random string (`openssl rand -hex 32`). It is required in production and optional in development.

### The first owner account

Set these two lines in `.env` **before** the first start:

```bash
SEED_ADMIN_EMAIL=you@example.com
SEED_ADMIN_PASSWORD=choose-a-long-password
```

On startup, if no user exists yet, the server creates that owner for you. It never changes a password or brings back an account you deleted. Use at least 12 characters: in production a shorter password stops the server from starting.

If you leave them unset, the first person to open <http://localhost:3000/admin> gets to create the owner account. That is fine on your own machine, but on a public deployment someone else could get there first, so always set both variables when deploying.

## How it works

| Route | What it is |
| --- | --- |
| `/` | Homepage: the page with the slug `home`, or a sensible default until you publish one |
| `/pets` | Catalog with filters and pagination (fixed route) |
| `/pets/[slug]` | Pet page with photos, details and WhatsApp button (fixed route) |
| `/[slug]` | Any page you build, such as `/about` |
| `/admin` | Payload admin: Pets, Pages, Media, Users, Site settings |
| `/edit/[id]` | Puck page builder for one page (owners only) |
| `/health` | Liveness check for hosting platforms |

### Adding pets

In **Admin → Pets**, add a name, photos and details. The form is split into tabs: Basics (species, age, size, colour, and city and state, which fill in the location text shown to visitors; spell cities and states the same way every time so filters group them), Health and behaviour (vaccinated, microchipped, house-trained, special needs, temperament, who they get along with, health notes), Photos and story (up to 10 photos, description, video link) Adoption (fee, rescue date, and an optional WhatsApp number for pets with a foster) and SEO (an optional search and share title, description and image; empty fields fall back to a generated title, a summary and the first photo). Tick **Urgent** in the sidebar for pets that need a home soon. Tick **Unlisted** to keep a pet out of the catalog, pet grids, the public API and search engines while still letting anyone with the direct link open its page, which suits a pet you are not ready to promote. The first photo is the cover. Mark a pet **Adopted** when it finds a home; it stays visible with an "Adopted" badge, which doubles as social proof. Tick **Featured** to include it in "featured" pet grids.

### Building pages

1. **Admin → Pages → Create new**, give it a title and slug (use `home` for the homepage).
2. Save, then click **Open page builder**.
3. Drag blocks into the page, edit them in the sidebar, and press **Save draft** or **Publish**. Visitors only ever see published pages.

Built-in blocks: Hero banner, Text, Image gallery, Pet grid (live data, filterable), Call to action, Adopter stories, FAQ, Contact and map, Social links.

### Site settings

**Admin → Site settings** holds the site name, logo, brand colour, WhatsApp number and message, address, opening hours, social links and header menu. Numbers starting with `0` get the country code from `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE` (default `60`, Malaysia). In the WhatsApp message, `{pet}` is replaced with the pet's name.

## Adding your own block

Blocks live in [`src/puck/config.tsx`](src/puck/config.tsx). Add a props type, then an entry under `components` with `fields`, `defaultProps` and a `render` function, and list it in a `categories` group so it shows up in the editor.

Keep `render` functions free of hooks and browser-only code: the same components render on the server for visitors and inside the editor. Site settings arrive through `puck.metadata.site`, and live pets through `metadata.fetchPets`.

## Production

1. **Use PostgreSQL.** Set `DATABASE_URL=postgres://...` (Neon, Supabase, your own server). `docker compose up -d` starts a local one for testing; it only listens on `127.0.0.1`, and you can change its password with `POSTGRES_PASSWORD`. SQLite needs a persistent disk, so it only suits a single VPS. On a pooled connection (Neon, Supabase), use the pooler URL and set `DB_POOL_MAX` low (1 to 3) on serverless hosts.
2. **Run migrations.** With PostgreSQL the schema is never changed automatically; SQLite pushes its own schema in development.
   ```bash
   pnpm migrate:create   # after changing collections; commit the generated files in src/migrations
   pnpm migrate          # on every deploy, before starting the app
   ```
   Migrations are per database, so they are generated and applied against PostgreSQL only. The initial one is already committed in `src/migrations`, so a new database only needs `pnpm migrate`. Whenever you change a collection or global, run `pnpm migrate:create <name>` against a Postgres database and commit the new files, or the production schema will fall behind your code.
3. **Set the required variables.** In production the server refuses to start without them:
   - `PAYLOAD_SECRET`: at least 32 random characters (`openssl rand -hex 32`).
   - `NEXT_PUBLIC_SERVER_URL`: your public URL, such as `https://adopt.example.com`. It is also the only origin allowed to make signed-in requests, so use the exact address visitors and owners use.
   - `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`: so the first owner exists before anyone can reach `/admin` (see above).
4. **Store uploads somewhere durable.** Without configuration, uploads are written to `./media`, which suits a VPS or a Docker volume. On serverless platforms (Vercel and similar) set the `S3_*` variables for S3, Cloudflare R2 or MinIO. If `S3_BUCKET` is set, the access key and secret are required too, and `S3_REGION` must be a real region for AWS S3 (`auto` is for R2).
5. `pnpm build && pnpm start`

Pages are cached and refresh immediately when you publish; they also revalidate every 60 seconds.

### Security defaults

- Visitors can only read published pages and pet and media data. Everything else needs an owner login, with a five-attempt lockout and two-hour sessions. Session cookies are HTTPS-only in production.
- GraphQL is turned off. REST requests are limited to a nesting depth of 3.
- Uploads must be JPEG, PNG, WebP, AVIF or GIF, up to 10 MB. SVG is blocked because it can carry script.
- Social and menu links are checked when saved, and rendered through a safe-link filter that blocks `javascript:` and `data:` URLs.
- The last owner account cannot be deleted, and an image still used by a pet or page cannot be deleted.
- There is no per-IP rate limiting. Put one at your reverse proxy or CDN, especially for the login and password-reset endpoints.
- Security headers are set in `next.config.ts`: `nosniff`, no framing by other sites, a strict referrer policy and a Content-Security-Policy. The policy only allows scripts, styles, images and connections from your own site, plus a Google Maps embed, and blocks plugins and eval in production. Inline scripts stay allowed because Next.js and Payload need them and a nonce would end page caching. If you add an embed, analytics script or external image, extend the policy in `next.config.ts`; set `CSP_REPORT_ONLY=1` first to see what it would block without breaking anything.

## Scripts

| Command | Does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm seed` | Sample content. Safe to re-run, leaves a real site alone, and refuses to run in production without `SEED_FORCE=1`. The owner account comes from `SEED_ADMIN_*` on startup |
| `pnpm migrate:create` / `pnpm migrate` | Create and apply PostgreSQL migrations |
| `pnpm typecheck` / `pnpm lint` | Static checks |
| `pnpm generate:types` | Regenerate `src/payload-types.ts` after changing collections |
| `pnpm generate:importmap` | Regenerate the admin import map after adding admin components |

## Known limitations

- The page builder preview renders inside the page (not an iframe), so it uses the real site styles but does not emulate mobile breakpoints. Check mobile on the live page.
- Pages are single-level (`/about`, not `/about/team`).
- The slug `home` is the homepage, and `admin`, `api`, `edit`, `health` and `pets` are reserved.
- Photos cannot be SVG. Convert them to PNG or WebP first.

## Contributing

Issues and pull requests are welcome. Please run `pnpm typecheck` and `pnpm lint` first.

## License

[MIT](LICENSE)
