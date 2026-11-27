# Pet Adopt

An open-source storefront for adoptable pets, built for rescuers, shelters and pet businesses.

Visitors browse a catalogue and contact you on **WhatsApp** or social media. There are no visitor accounts and no checkout. Your team signs in, adds pets, and designs the site with a drag-and-drop **page builder**.

- **Catalogue and pet pages:** filter by species, age, sex, size, status and location. Filters live in the address, so any search can be shared. Every pet's page is drawn from one layout you design in the page builder.
- **WhatsApp-first:** each pet page has a click-to-chat button with a prefilled message.
- **Page builder:** the homepage and any other page (About, FAQ, Events...) are built from 20+ blocks with [Puck](https://puckeditor.com). It autosaves, previews phone and tablet widths, keeps version history, and lets you set padding on every block.
- **Forms:** adoption applications, volunteer sign-ups or questions, with email notifications, an optional confirmation to the visitor, a spam trap and optional captcha. Responses stay in your admin.
- **A team admin at `/admin`:** four roles (admin, editor, developer, audit), email invites, optional two-factor sign-in, sign-in with your own OAuth/OpenID Connect provider, and an activity log of who changed what.
- **Email built in:** any SMTP server, with templates you design in a drag-and-drop email builder.
- **Search and sharing:** server-rendered, cached pages with canonical addresses, share cards for WhatsApp, Facebook and X, `sitemap.xml`, `robots.txt` and structured data.
- **Self-contained:** your own database (SQLite or PostgreSQL) and sign-in, uploads in any S3-compatible storage, no required outside service.

Built with Next.js, Drizzle ORM, Better Auth, shadcn/ui and Puck. MIT-licensed.

## Quick start

Requires Node.js 22.23.4 or newer (or 24.22.1+), [pnpm](https://pnpm.io), and Docker for the local services. Install and run the project with pnpm only; there is no npm lockfile.

```bash
git clone <your-fork-url> pet-adopt
cd pet-adopt
cp apps/web/.env.example apps/web/.env
# In apps/web/.env, replace the two S3 key placeholders with the development keys
# shown at the top of docker-compose.yml.
docker compose up -d garage mailpit   # upload storage and a test inbox
pnpm install
pnpm dev
```

Open <http://localhost:3000>, then follow the setup link in the server's log (see below).

- **Database:** local development uses a SQLite file (`data/pet-adopt.db` at the repo root, git-ignored). It creates and migrates its own schema on first start.
- **Uploads:** they always go to S3-compatible storage, never to the server's disk. In development that is the Garage server in `docker-compose.yml`, a small single-node S3 server on port 9000. `pnpm --filter @pet-adopt/web storage:check` confirms it works.
- **Email:** in development, mail goes to Mailpit. It accepts any mail on port 1025 and shows it at <http://localhost:8025>; point Admin → Email at it.
- **Secret:** set `BETTER_AUTH_SECRET` in `.env` to a long random string (`openssl rand -hex 32`). It is required in production.

### The first account

Start the server on a new site and look at its log. While no account exists, it prints a **setup link** with a one-time key:

```
| This site has no accounts yet. Open this link to create the first admin account: |
| http://localhost:3000/setup?key=…                                                 |
```

Open it to create the first admin account.

- **Who can use it:** only someone who can read the server's log has the link, so nobody else can claim a fresh deployment first.
- **When it stops working:** once the account exists. Opening `/setup` without the key prints the link again.

A short guided setup follows:

1. the site's name and WhatsApp number;
2. a theme;
3. optional sample content (six example pets and an About page);
4. email.

Every step can be skipped and changed later in the admin.

There is no public sign-up. An admin adds more people in **Users**, by emailing an invite by default.

**Unattended installs:** set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` instead, and the server creates that admin on startup. In production the password needs at least 12 characters. The server never changes a password or brings back a deleted account. The guided setup then starts after signing in.

## A tour of the admin

The sidebar has three sections, each showing only what your role can see:

| Section | Screens |
| --- | --- |
| **Content** | **Pets**, **Pages** (with the page builder) and **Media** (the image library) |
| **Plugins** | **Forms** (the form builder) and any other plugin you add |
| **Settings** | **Email** (sending and templates), **Theme**, **Users**, **Authentication** (two-factor, sign-in providers, archived accounts), **Activity** and **Site settings** |

The **Dashboard** shows recent activity and a card from each plugin.

## Routes

| Route | What it is |
| --- | --- |
| `/` | The homepage: the page with the address `home`, or a built-in layout until you publish one |
| `/pets` | The Pets page: the catalogue with filters and paging, inside a layout you can edit |
| `/pets/[slug]` | A pet's page, drawn from the **Pet page template** |
| `/[slug]` | Any page you build, such as `/about` |
| `/admin` | The team admin |
| `/edit/[id]` | The page builder for one page (signed in only) |
| `/setup` | First-time setup (only while it isn't finished) |
| `/media/[file]` | Uploaded images, served from your S3 bucket |
| `/sitemap.xml`, `/robots.txt` | For search engines |
| `/api/auth/*` | Sign-in endpoints (Better Auth). Sign-up and everything else Better Auth ships return 404 |
| `/health` | Liveness check for hosting platforms |

## Project structure

A pnpm workspace with Turborepo:

```
apps/web/                 The Next.js app, backend included
├── src/
│   ├── app/              Routes (App Router). Each route group has its own layout
│   │   ├── (frontend)/   The public site; plain CSS driven by theme variables
│   │   ├── (admin)/      The team admin under /admin
│   │   ├── (auth)/       Signed-out screens: sign-in, reset password, invites, confirm email
│   │   ├── (editor)/     The page builder (/edit/[id]) and the email template builder
│   │   ├── (setup)/      First-time setup
│   │   ├── sitemap.ts robots.ts
│   │   └── api/ media/ health/
│   ├── server/           The backend: plain TypeScript, no UI
│   │   ├── pets.ts pages.ts media.ts settings.ts users.ts ...   The data rules, one file per area
│   │   ├── actions/      'use server' functions the UI calls; each checks permission first
│   │   └── auth.ts session.ts throttle.ts two-factor.ts ...     Sign-in, sessions, limits
│   ├── db/               schema/sqlite.ts and schema/pg.ts (the same tables twice), client.ts
│   ├── puck/             Page builder blocks (config.tsx, pet-page-config.tsx, email-config.tsx)
│   ├── plugins/          The plugin runtime: registry, storage, host services
│   ├── components/       Public site and admin components
│   └── lib/              Shared helpers: theme, links, SEO, cached public queries
├── drizzle/              Generated SQL migrations (sqlite/ and pg/), committed
├── scripts/              seed, migrate, check-schemas, check-backend, reset-password, ...
└── pet-adopt.config.ts   Which plugins the site uses
packages/ui/              shadcn/ui components (Base UI), shared by the app and plugins
packages/plugin-sdk/      What plugins import (definePlugin, host(), types). Imports nothing from the app
plugins/form-builder/     The form builder plugin
plugins/adoption-tips/    A small example plugin
```

### How the pieces fit

- **No separate API.** The admin calls the functions in `apps/web/src/server/actions/` directly (Next.js server actions). Each one checks the signed-in person's permission first, and returns `{ ok: true, data }` or `{ ok: false, error, fieldErrors }`. The public site reads through `src/lib/queries.ts`, which only ever returns published pages and listed pets.
- **One data layer, two databases.** `src/server` is written once.
  - Drizzle's SQLite and PostgreSQL table types differ, so the schema exists twice (`src/db/schema/`). `pnpm check:schemas` fails if the two drift apart.
  - Keep columns portable: integer ids, JSON for lists, plain text for options.
- **Sign-in** is [Better Auth](https://better-auth.com) on the same database.
  - Roles and permissions are this project's own (see Users and roles).
  - Sign-in attempts are rate limited in a table of our own.
- **Uploads** are checked, stripped of metadata without recompressing, and stored under random names in S3-compatible storage.
- **Theming** is data: a preset plus optional customisations produce CSS variables, and both the public CSS and the shadcn components read those variables.
- **Plugins** add admin screens, dashboard cards, their own database tables and email templates. They reach the app only through `host()` from the plugin SDK. The form builder is one.

## Using it

### Adding pets

In **Pets**, add a name, photos and details. The form is split into tabs:

| Tab | Holds |
| --- | --- |
| **Basics** | Species, breed, sex, age, size, colour, and country, city and state. The country starts as your site's (Site settings > Region) and can be changed for a pet somewhere else. City and state suggest that country's places, and picking a city fills its state; anything else can still be typed, so spell it the same way every time and the filters group it. They fill in the location visitors see, and a pet in another country gets the country's name added on its page |
| **Health and behaviour** | Vaccinated, neutered, microchipped, house-trained, special needs, health notes, temperament, who they get along with, personality notes |
| **Photos and story** | Up to 10 photos (the first is the cover), the description, a video link |
| **Adoption** | Fee, rescue date, and an optional WhatsApp number for pets with a foster |
| **Search and sharing** | An optional title, description and image for search results and shares. Empty fields fall back to a generated title, a summary and the first photo |

The notes and the description are rich text: bold, italic, underline, lists and links.

In the sidebar:

- **Urgent:** marks a pet that needs a home soon.
- **Featured:** includes the pet in "featured" pet grids.
- **Unlisted:** keeps a pet out of the catalogue, pet grids and search engines, while anyone with the direct link can still open its page.
- **Adopted:** use it once the pet finds a home. Its page stays up with an "Adopted" notice and no WhatsApp button, which doubles as social proof.

### Building pages

1. In **Pages**, choose **New page**, and give it a title and an address.
2. Open the **page builder**, drag blocks onto the page, and edit each one in the right sidebar.
3. **Publish.** Visitors only ever see published pages.

The builder:

- **Autosaves your draft** a few seconds after you stop editing.
  - **Save draft** shows "Saved" when there's nothing to save.
  - **Publish** is unavailable when the live page already matches.
- **Previews** the page at phone, tablet and laptop widths, and in dark mode.
- **Keeps a version history** for each page (in its settings), so you can restore an earlier version as a draft or straight to live.
- **Changing pages:** a page can be archived and restored. Its title, address and search settings wait for the next publish, like its layout does.

**Blocks:**

| Group | Blocks |
| --- | --- |
| Headers and text | Hero banner, Text, Image + text, Features with icons, Call to action |
| Pets | Pet catalogue, Pet grid, Pet spotlight |
| Media | Image grid, Image carousel, Video (YouTube, Vimeo) |
| Adoption | Adoption steps, Numbers, Adopter stories, Team, Ways to help, Cost table, FAQ |
| Contact | Form, Contact & map, Social links |
| Layout | Spacer, Divider |

Every block except Spacer has a **Padding** option for the space above and below it.

**The homepage and the Pets page** are pages too. Edit them like any other. Until you publish your own, they show a built-in layout.

**The Pet page template** (Pages → *Pet page*) is one layout that draws every pet's page.

- **Pet blocks:**
  - **Pet gallery:** a large photo with thumbnails.
  - **Pet summary:** the name, status and facts, with an optional photo beside them.
  - **Pet description:** with the WhatsApp button, whose label can use `{pet}`, `{species}`, `{breed}`, `{age}`, `{sex}` and `{location}`.
  - **Pet health** and **Pet personality.**
  - **More pets like this:** the same species first, then the same area.
- **Ordinary blocks:** a few of the usual ones are also available.
- **Preview:** in the builder, **Preview with** picks which pet to show while designing.

### Forms

**Forms** (a plugin) builds forms for the Form block.

- **Questions:** short and long answers, email, phone number, number, date, one choice, several choices, a tick box, and a choice from site data ("Which pet?": the pets on offer).
- **Responses:** stored in the admin, with CSV download.
- **Each form can also:**
  - email new responses to your team;
  - send the visitor a confirmation;
  - use your own email templates.

**Privacy.** Forms collect personal data, so publish a **privacy policy** page and choose it in **Site settings → Navigation**. While it's live, every form and the footer link to it. The form builder warns you until there is one.

**Spam.**

- **The spam trap:** every form has a hidden box that only bots fill in. Their answers are dropped quietly. You can switch it off per form, under **Spam trap**.
- **Captcha:** for stronger protection, add one in **Forms → Spam protection**, using Cloudflare Turnstile, Google reCAPTCHA v3 or v2, or hCaptcha, with your own keys.
  - **Keys must pass a check first.** Saved keys only protect forms after **Check these keys** verifies them.
  - **If the service can't be reached,** forms are refused with an explanation.
  - Mention the service in your privacy policy.

### Users and roles

**Users** lists the people who can sign in. Only admins manage users. Each person has a role:

| Role | Can do |
| --- | --- |
| **Admin** | Everything, including users, sign-in settings and the whole activity log |
| **Editor** | Pets, pages, media, plugin content, and form responses (with CSV download) |
| **Developer** | Pets, pages, media, plugin content, theme, site settings, email and plugins. No users and no form responses |
| **Audit** | Sees everything, changes nothing, cannot download data |

**Safeguards:**

- The first account is always an admin.
- The last active admin can't be demoted, archived or deleted.

**Adding people:** new people get an **email invite**. If the site can't send email yet, you get a link to copy. Every account must confirm its email address before it can change anything, while the site can send email.

**Removing people** works like pages:

- **Archive** first: the person is signed out and can't sign in, but their name stays in the history.
- **Restore** brings an archived account back as it was.
- **Delete** removes the account for good, and anonymises their activity log entries.

People can delete their own account from **Account**. It closes at once, and is deleted after 30 days unless an admin restores it.

**Signing in:**

- **Two-factor:** with an authenticator app and backup codes. It's optional, and admins can require it for chosen roles (**Authentication**).
- **Your own sign-in provider:** add one under **Authentication → Sign-in providers** (OAuth 2 or OpenID Connect). Each person connects it from **Account**. Providers never create accounts. A provider's addresses must be on the public internet; set `AUTH_PROVIDER_PRIVATE_ADDRESSES=1` if yours runs on your own network.
- **Your own account:** everyone manages their picture, name, password, email address, two-factor and connected providers under **Account**.

### Email

**Email → Sending** connects any SMTP server; the password is stored encrypted. Environment variables (`SMTP_*`, `EMAIL_FROM`) can set or override any field.

**Email → Templates:**

- **System emails** (password reset, invite, email confirmation and notices) are edited in place, with **Restore default**.
- **Templates of your own** can be used wherever a plugin lets you pick one, for example a form's notifications.

Both are designed in a drag-and-drop email builder and sent as email-safe HTML, including for older Outlook.

### Site settings and themes

**Site settings:**

- **Brand:** name, tagline, logo, site icon, and the light/dark switch.
- **Contact:** the WhatsApp number and message (`{pet}` becomes the pet's name), address, opening hours and social links.
- **Region:** your country and time zone. New pets start with the country (each pet can have its own), and the pet form suggests its cities and states. The admin shows every time (the activity log, page versions, form responses) in the time zone; leave it empty and each person sees their own device's time. Until you pick a country, the one of `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE` is used.
- **Navigation:** the menu, footer text and privacy policy page.

Numbers without a country code use `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE` (default `60`, Malaysia).

**Theme** sets the look of the whole site. Admins and developers can change it.

- **Presets:** each bundles light and dark colours, fonts, corner radius, button shape, shadows, spacing and text size.

  | Preset | Feel |
  | --- | --- |
  | Sunrise | Warm orange and familiar. The original look |
  | Meadow | Fresh green, rounded Nunito type, soft shadows |
  | Ocean | Calm blue, DM Sans, tighter corners |
  | Heritage | Deep red, Lora serif headings, square corners, generous space |
  | Studio | Black and white, Playfair headings, bold hard-edged shadows |

- **Your own themes:** start from a preset or a copy, adjust fonts, corners, buttons, shadows, spacing, text size and colours, and save as many as you like.
  - A live preview shows real blocks as you edit.
  - Colours that would make text hard to read are refused.
- **Light and dark:** visitors get a light/dark switch that follows their device until they choose. Turn it off in Site settings to keep the site light only.

Fonts are served from your own domain (not from Google), so pages make no outside requests for them.

### Search engines and sharing

- **Every public page has:**
  - a canonical address;
  - a share card, using the page's or pet's own title, description and image from their settings.
- **The homepage** also tells search engines who you are (name, logo, contact, social profiles), and pet pages show their place in the site (Home › Pets › pet).
- **`/sitemap.xml`** lists your live pages and every listed pet that isn't adopted, with its photo.
- **`/robots.txt`** keeps search engines out of the admin.
- **Previews and staging:** Vercel previews are never indexed. Set `SEARCH_INDEXING=off` on a staging server to keep it out of search too.

## Extending

### Adding a block

Blocks live in [`apps/web/src/puck/config.tsx`](apps/web/src/puck/config.tsx); the Pet page template's own blocks are in `pet-page-config.tsx`. To add one:

1. Add a props type.
2. Add an entry under `components` with `fields`, `defaultProps` and a `render` function.
3. List it in a `categories` group so it shows up in the editor.

The Padding option is added to every block automatically.

**Rules for `render` functions:**

- **No hooks or browser-only code.** The same components render on the server for visitors and inside the editor. For anything interactive, render a client component, like the Image carousel does.
- **Data comes through `puck.metadata`:** site settings through `puck.metadata.site`, and live data through its fetch functions.
- **Headings** go through the heading helpers, so each page keeps exactly one `<h1>`.

### Adding a plugin

A plugin is an npm package or a local folder that depends only on `@pet-adopt/plugin-sdk`.

- **What it can add:** admin screens, dashboard cards, its own database tables (with migrations), and default email templates.
- **How it reaches the site:** through `host()`, for permissions, rate limits, email, the activity log, encrypted secrets and the privacy policy.

To add a workspace plugin, run `pnpm --filter @pet-adopt/web add <name>@workspace:*` and list it in `apps/web/pet-adopt.config.ts`. After changing a plugin's tables, run `pnpm plugin:generate <folder> <change_name>`. [`plugins/adoption-tips`](plugins/adoption-tips) is a small example, and [`plugins/form-builder`](plugins/form-builder) a full one.

## Production

1. **Use PostgreSQL.**
   - Set `DATABASE_URL=postgres://...` (Neon, Supabase, your own server).
   - `docker compose up -d postgres` starts a local one for testing. It only listens on `127.0.0.1`, and `POSTGRES_PASSWORD` changes its password.
   - SQLite needs a persistent disk, so it only suits a single server.
   - On a pooled connection (Neon, Supabase), use the pooler URL and set `DB_POOL_MAX` low (1 to 3) on serverless hosts.
   - Hosted libSQL (Turso) is also supported, as an option.
2. **Migrations run as part of `pnpm build`.** For PostgreSQL and hosted libSQL, the build migrates the database first (the site's tables, then each plugin's) and fails if it can't, so new code never ships against an older schema. A local SQLite file migrates itself when the app opens it.
   ```bash
   pnpm db:generate      # after changing the schema; commit the new files in apps/web/drizzle/
   pnpm build            # migrates (PostgreSQL, hosted libSQL), then builds
   pnpm migrate          # the same migrations on their own, any time
   ```
   - **Preview builds** on Vercel (`VERCEL_ENV` other than `production`) skip migrations, because a preview usually shares the production database. Set `MIGRATE_ON_PREVIEW=1` when previews have their own database.
   - **Builds that can't reach the database** (a Docker image built without it): set `SKIP_BUILD_MIGRATE=1`, and run `pnpm migrate` before starting the server.
3. **Set the required variables.** In production the server refuses to start without them:
   - `BETTER_AUTH_SECRET`: at least 32 random characters (`openssl rand -hex 32`). Stored secrets (the SMTP password, provider and captcha keys) are encrypted with a key derived from it. Changing it means entering those secrets again.
   - `NEXT_PUBLIC_SERVER_URL`: your public address, such as `https://adopt.example.com`. Links in emails and share cards are built from it, and it is the only origin allowed to make signed-in requests.
   - **The first account:** use the setup link the server prints on first start, or set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`.
4. **Set up upload storage.**
   - **Where:** AWS S3, another provider with an S3 API (through `S3_ENDPOINT`), or an S3-compatible server you run yourself.
   - **Settings:** the `S3_*` variables. `apps/web/.env.example` explains each one, and production refuses to start without them.
   - **Access:** the bucket can stay private, because visitors load images through this site's `/media` route.
   - **Check:** `pnpm --filter @pet-adopt/web storage:check` writes, reads and deletes a test file, and says which setting is wrong if a step fails.
5. **Set up email** in Admin → Email (or with the `SMTP_*` variables), so invites, password resets and form notifications can go out.
6. `pnpm build && pnpm start`, behind a reverse proxy you control (see Security defaults).

**Caching:** pages refresh as soon as you publish, and also every 60 seconds.

## Security defaults

- **Access:**
  - Visitors can only read published pages and listed pets. Everything else needs a sign-in.
  - Sessions last two hours, and cookies are HTTP-only (HTTPS-only in production).
  - Each server action checks the person's role.
- **Sign-in protection:**
  - **Attempt limits,** counted before the password is checked: 30 per client address, 5 per email from one client (then ten minutes locked), and 100 per hour per email overall. Someone typing an owner's email from their own machine only locks themselves out.
  - **Recovery:** a locked-out owner can run `NEW_PASSWORD='...' pnpm admin:reset-password owner@example.com`, and `pnpm --filter @pet-adopt/web admin:reset-2fa <email>` turns off two-factor for the last admin.
  - **Client addresses:** they come from `X-Forwarded-For` (or `CLIENT_IP_HEADER`), counting `TRUSTED_PROXY_HOPS` entries from the end. Only a proxy you control can be trusted to add it.
- **No public API:** of Better Auth's endpoints, only sign-in, sign-out, session, change-password and sign-in provider callbacks are reachable. Everything else returns 404.
- **Uploads:**
  - **Allowed:** JPEG, PNG, WebP or GIF, up to 10 MB, 12000 px on a side and 40 megapixels.
  - **Refused:** SVG, because it can carry script.
  - **Metadata:** every image has its metadata (GPS position, device, comments, embedded thumbnails) cut out without recompressing, so the picture is byte-for-byte what was uploaded.
  - **AVIF and HEIC:** refused, because their metadata can't be removed without recompressing.
- **Links** typed into blocks and settings are checked when saved, and rendered through a filter that blocks `javascript:` and `data:` addresses.
- **Encrypted secrets:** the SMTP password, sign-in provider secrets, captcha secret keys and two-factor secrets are stored encrypted. Password reset, invite and email change links are stored only as hashes and work once.
- **The activity log** records changes, sign-ins and failed sign-ins, naming fields but never their values. It is kept for 365 days (`ACTIVITY_LOG_DAYS`).
- **Headers** are set in `apps/web/next.config.ts`: `nosniff`, no framing by other sites, a strict referrer policy, a Content-Security-Policy, and HSTS (one year) when the site's address is https.
  - **What the policy allows:** your own site, plus Google Maps, YouTube (no-cookie) and Vimeo embeds, and the four captcha services.
  - **Inline scripts** stay allowed because Next.js needs them, and a nonce would end page caching.
  - **Adding an embed or script:** extend the policy. Set `CSP_REPORT_ONLY=1` first to see what it would block.

## Scripts

Run from the repo root.

| Command | Does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build (migrates PostgreSQL or hosted libSQL first) and server |
| `pnpm seed` | Sample content (the same the first-time setup offers). Safe to re-run, leaves a real site alone, refuses to run in production without `SEED_FORCE=1` |
| `pnpm db:generate` | Generate SQL migrations for both databases after changing the schema |
| `pnpm migrate` | Apply pending migrations (the site's and the plugins') |
| `pnpm plugin:generate <folder> <name>` | Generate a plugin's migrations after changing its tables |
| `pnpm check:schemas` | Fail if the SQLite and PostgreSQL schemas have drifted apart |
| `pnpm check:backend` | End-to-end backend check against a throwaway database (see the script's header) |
| `pnpm admin:reset-password <email>` | Set a new password (from `NEW_PASSWORD`), sign the account out everywhere and lift its lockout |
| `pnpm --filter @pet-adopt/web admin:reset-2fa <email>` | Turn off two-factor for an account (for the last admin) |
| `pnpm --filter @pet-adopt/web storage:check` | Check the upload storage settings with a test file |
| `pnpm --filter @pet-adopt/web storage:copy-local` | Copy uploads a site once kept on disk into the bucket (`--from <folder>`, `--dry-run`) |
| `pnpm typecheck` / `pnpm lint` | Static checks, for every package |

## Known limitations

- Pages are single-level (`/about`, not `/about/team`).
- These addresses are reserved: `home` (the homepage), `admin`, `api`, `edit`, `health`, `media`, `pets`, `pet-page` and `setup`.
- Photos can't be SVG, AVIF or HEIC. Save them as JPEG, PNG or WebP first.
- The email template builder has no phone-width preview; emails use a fixed 600 px layout that stacks columns on small screens.

## Contributing

Issues and pull requests are welcome.

1. Fork, then `pnpm install` and `pnpm dev` (see Quick start). Use pnpm only.
2. Before opening a pull request, run `pnpm typecheck`, `pnpm lint` and `pnpm check:schemas`.
3. **If you touched the backend or a schema:**
   - Also run `pnpm check:backend`, ideally on both SQLite and PostgreSQL (the script's header explains how).
   - If you changed the schema, edit **both** schema files and commit the output of `pnpm db:generate`.
4. **Keep the project self-contained.** New features should work with npm packages only, with no required outside service. Optional integrations (S3 storage, Turso, captcha) are fine when the default needs nothing.
5. **Never put secrets in the repo.** `.env` is git-ignored; document new variables in `apps/web/.env.example`.

Found a security problem? Please see [`SECURITY.md`](SECURITY.md) and report it privately instead of opening a public issue.

[`CLAUDE.md`](CLAUDE.md) holds longer architecture notes. They're written for AI coding assistants, but are useful for people too.

## License

[MIT](LICENSE), copyright © 2026 muhammadarifftaha.

### Data credits

The countries, and the city and state suggestions in the pet form, come from the [Countries States Cities Database](https://github.com/dr5hn/countries-states-cities-database), installed as the npm package [`@countrystatecity/countries`](https://www.npmjs.com/package/@countrystatecity/countries). That database is made available under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/), and any rights in its individual contents under the [Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/). It is not covered by this project's MIT licence.

- The site reads the data unchanged from the installed package and keeps only the place names people pick; this repository holds no copy of it.
- The database draws on other open sources (national statistics offices, postal services, GeoNames and others), each with its own credit. They are listed in the `NOTICE-*.txt` files inside the package (`node_modules/@countrystatecity/countries/`). If you pass the data on, for example in a container image or another bundle of the site, keep those files and the package's `LICENSE` with it.
- If you publish a changed version of the database, the ODbL asks you to share it under the same licence.
