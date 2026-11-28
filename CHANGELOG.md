# Changelog

What changed in each release, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**Versions:** the project is below 1.0, so a minor version (0.2.0) may need action from you when you update, and a patch version (0.1.1) never does. Anything that needs action is listed under **Upgrading** in that release. Each release is a git tag (`v0.1.0`), and the npm packages carry the same version number. To update a site, see [Updating](apps/docs/content/docs/developers/deployment/backups-and-updates.mdx#updating) in the deployment guide.

## 0.1.0 (28 Nov 2026)

The first tagged release. A site starts as a clone of this repository.

### The site

- **Catalogue:** a searchable, filterable list of adoptable pets with a page for each pet, and contact through WhatsApp or social media. Visitors have no accounts.
- **Pages:** a drag-and-drop page builder with drafts, autosave, publishing, version history and restore. The homepage, the Pets page and the layout of every pet's page are edited the same way.
- **Pet timeline:** dated updates on each pet's page (a title, rich text and photos), posted from the pet's screen in the admin and drawn by the **Pet timeline** block of the Pet page template.
- **Themes:** built-in presets and saved custom themes, with light and dark modes and contrast checks.
- **Search and sharing:** `sitemap.xml`, `robots.txt`, canonical addresses, share cards and structured data.

### The admin

- **Content:** pets, pages and a media library. Uploads have their metadata removed without recompressing.
- **People:** four roles (admin, editor, developer, audit), email invites, archived accounts and account deletion.
- **Sign-in:** passwords, two-factor with an authenticator app, and your own OAuth 2 or OpenID Connect providers.
- **Email:** a built-in SMTP sender and an email template builder.
- **Activity log:** who changed what and when, without storing the values.
- **First-time setup:** a one-time setup link in the server's log, then a short guided setup.
- **Region:** a country and a time zone for the site, and a country for each pet.

### Plugins

- **A plugin system:** admin screens, dashboard cards, a plugin's own database tables, default email templates and an email sender, through `@pet-adopt/plugin-sdk`.
- **Page builder blocks from plugins:** a plugin adds blocks with `definePluginBlock` and a server loader (`blockLoaders`). A site lists the blocks in `apps/web/pet-adopt.blocks.ts`, beside `pet-adopt.config.ts`. Blocks can fill a dropdown from the plugin's own records, appear in the Pet page template, and redraw the site after a change with `host().revalidateSite()`.
- **Form builder:** public forms with responses, email notifications, a privacy policy link and captcha spam protection. The **Form** block now lives in the plugin; pages saved before keep their forms.
- **Instagram feed:** a profile and its latest posts as a page builder block, for Business and Creator accounts, with pinned posts and a cached feed.
- **Adoption tips:** a small example plugin, in the repository for plugin authors to copy. It is not published to npm.
- **Plugin guide:** [in the docs](apps/docs/content/docs/developers/plugins/index.mdx), for writing, packaging and publishing a plugin.

### Packages

- **On npm:** the plugin SDK (`@pet-adopt/plugin-sdk`), the form builder (`@pet-adopt/plugin-form-builder`) and the Instagram feed (`@pet-adopt/plugin-instagram-feed`), shipped as compiled JavaScript with type declarations.
- **npm plugins in a site:** a site can install a plugin from npm, list it in `pet-adopt.config.ts` and its blocks in `pet-adopt.blocks.ts`. The styles of plugins named `@pet-adopt/plugin-*` are picked up by themselves; a plugin with another name needs one Tailwind `@source` line.
- **Releasing:** [the maintainer's runbook](apps/docs/content/docs/developers/contributing/releasing.mdx).

### Running it

- **Databases:** SQLite (a local file or hosted libSQL) or PostgreSQL, with migrations applied on build or on start.
- **Storage:** uploads go to any S3-compatible object storage.
- **`pnpm setup:env`:** writes `apps/web/.env` with a new secret (and, for development, the local storage keys), for a first start with no hand editing.
- **`CSP_IMG_SRC`:** lets a site allow pictures from other https hosts, such as Instagram's for the Instagram feed. A wrong value stops the server at start, so a typing mistake cannot widen the policy.
- **Deployment guide:** [in the docs](apps/docs/content/docs/developers/deployment/index.mdx).
- **Documentation site:** `apps/docs`, built with Fumadocs, in two sections: one for the people who run a site, one for developers. Every page is also served as Markdown (`/llms.txt`, `/llms-full.txt`).
- **Security:** see [SECURITY.md](SECURITY.md) for the defaults and how to report a problem.
