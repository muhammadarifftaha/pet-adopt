# Changelog

What changed in each release, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**Versions:** the project is below 1.0, so a minor version (0.2.0) may need action from you when you update, and a patch version (0.1.1) never does. Anything that needs action is listed under **Upgrading** in that release. Each release is a git tag (`v0.1.0`); to update a site, see [Updating](docs/deployment.md#updating) in the deployment guide.

## 0.1.0 (2026-11-27)

The first tagged release.

### The site

- **Catalogue:** a searchable, filterable list of adoptable pets with a page for each pet, and contact through WhatsApp or social media. Visitors have no accounts.
- **Pages:** a drag-and-drop page builder with drafts, publishing, version history and restore. The homepage, the Pets page and the layout of every pet's page are edited the same way.
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

- **A plugin system:** admin screens, dashboard cards, a plugin's own database tables and default email templates, through `@pet-adopt/plugin-sdk`.
- **Form builder:** public forms with responses, email notifications, a privacy policy link and captcha spam protection.
- **Adoption tips:** a small example plugin.

### Running it

- **Databases:** SQLite (a local file or hosted libSQL) or PostgreSQL, with migrations applied on build or on start.
- **Storage:** uploads go to any S3-compatible object storage.
- **`pnpm setup:env`:** writes `apps/web/.env` with a new secret, for a first start with no hand editing.
- **Deployment guide:** [docs/deployment.md](docs/deployment.md).
- **Security:** see [SECURITY.md](SECURITY.md) for the defaults and how to report a problem.
