# Form builder

`@pet-adopt/plugin-form-builder`: a plugin for [Pet Adopt](https://github.com/muhammadarifftaha/pet-adopt), an open-source storefront for adoptable pets. Build forms for the site (adoption applications, volunteer sign-ups, questions) and read what visitors send, in the admin.

- **Forms:** a form editor with ten question types, and the **Form** block to place a form on any page.
- **Responses:** stored in the site's own database, read and downloaded (CSV) in the admin.
- **Email:** new responses to your team, and an optional confirmation to the visitor, using the site's email templates.
- **Privacy:** a warning until the site has a published privacy policy, and a link to it under every form.
- **Spam:** a hidden spam trap on every form, sending limits, and optional captcha (Cloudflare Turnstile, Google reCAPTCHA v3 or v2, or hCaptcha) with your own keys.

## Installing

> **Not published yet:** this package is not on npm yet; it will be published with the first release. In the Pet Adopt repository it is already installed as a workspace package (see [In this repository](#in-this-repository)), so a site cloned from it has the plugin and its block already.

### From npm, in a site

From the site's root folder:

**1. Add the package** to the web app:

```bash
pnpm --filter @pet-adopt/web add @pet-adopt/plugin-form-builder
```

`@pet-adopt/plugin-sdk` and `@pet-adopt/ui` are peer dependencies: the plugin uses the site's own copies, which every Pet Adopt site has. So are the packages the web app already installs (`next`, `react`, `react-icons` and `drizzle-orm`).

**2. List the plugin** in `apps/web/pet-adopt.config.ts`, beside the plugins already there:

```ts
import { defineConfig } from '@pet-adopt/plugin-sdk'
import { formBuilder } from '@pet-adopt/plugin-form-builder'

export default defineConfig({
  plugins: [formBuilder()], // or formBuilder({ title: 'Applications' }) to rename it in the admin
})
```

**3. List the Form block** in `apps/web/pet-adopt.blocks.ts`, keeping any other blocks already in the list. That file is loaded by the browser, so the block comes from its own entry point, never from the plugin itself:

```ts
import { defineBlocks } from '@pet-adopt/plugin-sdk'
import { formBlock } from '@pet-adopt/plugin-form-builder/block'

export default defineBlocks([formBlock])
```

Both steps are needed: step 2 gives the screens, the tables and what the block loads; step 3 puts the block in the page builder.

**4. Check that the admin's CSS finds the plugin.** Tailwind only writes the class names it can find, and it does not look inside `node_modules` by itself. The site's `packages/ui/src/styles/globals.css` needs this line, which Pet Adopt sites have already:

```css
@source "../../../../apps/web/node_modules/@pet-adopt/plugin-*/dist";
```

Without it the screens work but look unstyled in places.

**5. Create its tables.** The plugin has its own database tables.

```bash
pnpm migrate
```

- **A local SQLite file** needs nothing: the tables are made when the site starts.
- **PostgreSQL and hosted libSQL** need `pnpm migrate`. `pnpm build` runs it too.
- **Before migrating:** until it has run, the plugin's screens explain what to run instead of failing, and Form blocks show nothing on the site.

**Removing the plugin:** take it out of `pet-adopt.config.ts` and its block out of `pet-adopt.blocks.ts` (then, if you like, `pnpm --filter @pet-adopt/web remove @pet-adopt/plugin-form-builder`). Its tables and data stay; pages that used the block stop showing it.

### In this repository

The plugin is the workspace package in `plugins/form-builder`, already added to the web app (`pnpm --filter @pet-adopt/web add @pet-adopt/plugin-form-builder@workspace:*`) and listed in both `apps/web/pet-adopt.config.ts` and `apps/web/pet-adopt.blocks.ts`. The web app compiles its TypeScript source, and Tailwind reads it through the `@source "../../../../plugins";` line. Its tables are made like any plugin's: on start with a local SQLite file, with `pnpm migrate` (or `pnpm build`) on PostgreSQL and hosted libSQL.

## Using it

In the admin, **Forms** lists every form, with its responses.

1. **New form:** give it a name, then add questions in the editor.
2. Add a **Form** block (under **Plugins**) to a page, or to the Pet page template, in the page builder and pick the form. The form's name is the block's heading unless you give it another.
3. Responses arrive in **Forms → (the form) → Responses**. New ones are marked until someone opens them.

### Questions

| Type | Notes |
| --- | --- |
| Short answer, Long answer | Plain text |
| Email | Checked as an email address |
| Phone number | Checked with the site's phone rules; stored in international format (`+60…`) |
| Number, Date | Real numbers and real calendar dates only |
| One choice | Radio buttons or a dropdown |
| Several choices | Checkboxes |
| Tick box | One box, such as "I agree" |
| Choice from site data | A dropdown filled from the site when the form is shown. Today: **Which pet?**, the pets that are listed and not adopted. The pick is checked when the form is sent, and stored as the pet's name plus a reference |

**Each question can have:**
- a label;
- a hint;
- a required mark;
- options, for the choice types.

**Changing a question** never changes the answers already received, because each answer keeps the label and type it was given under.

**Limits:**
- 50 questions per form;
- 30 options per question;
- 200 characters per label.

### Each form's settings

- **Button text** and the **message after sending**.
- **Email new responses to:** an address for your team, with a choice of template (**Email → Templates**).
- **Confirmation to the visitor:** sent to the address given in one of the form's Email questions.
  - It never repeats their answers, since anyone can type any address into a public form.
  - Each address gets at most 3 an hour.
- **Open or closed:** a closed form still shows on the page, with a note that it isn't accepting responses.
- **Spam trap:** see below.

**Emails need the site's email set up** (**Email → Sending**). Without it, responses are still stored; only the emails are skipped. The plugin brings two templates, **Form response** and **Form confirmation**, which forms use until you pick others. You can edit them in **Email → Templates** and restore them, but not delete them.

## Privacy

Forms collect personal data, and visitors must be told how it's used, where they type it.

- **Until the site has a live privacy policy:**
  - the **Forms** screen and the **New form** dialog show a warning;
  - admins and developers get a link to choose the policy page in **Site settings → Navigation**.

  It's a warning, not a block, so forms can be drafted while the policy is written.
- **Once the policy page is live,** every form shows "We use your answers as described in our *Privacy policy*" under its button, linking to it.
- **Who sees responses:** admins and editors. Audit can view them but not download them, and developers can't open them at all.
- **What the activity log records:** changes to forms and downloads of responses, naming fields but never answers.

## Spam

Three layers, in this order, before anything is stored:

1. **Sending limits:**
   - 10 sends per 10 minutes from one visitor;
   - 200 an hour per form, from everyone.
2. **The spam trap** (honeypot): every form has a hidden box labelled "Website".
   - **Who fills it:** people never see it, and screen readers and the keyboard skip it. Bots fill in every box, so a filled trap marks a bot.
   - **What a bot gets:** the usual "sent" message, while nothing is saved, emailed or counted.
   - **Where to change it:** the **Spam trap** card in the form editor, apart from the questions. It's on by default.
   - **When to switch it off:** only if a tool you use fills forms in automatically.
   - **Reserved name:** a question can never have the id `website`, or its real answers would look like spam.
3. **Captcha (optional)** in **Forms → Spam protection**, for admins and developers.
   - **Services:** Cloudflare Turnstile, Google reCAPTCHA v3 (invisible, with a minimum score), reCAPTCHA v2 or hCaptcha.
   - **Keys:** paste the site key and secret key from that service. The secret is stored encrypted and never shown again.
   - **Keys must pass a check first.** Saved keys protect forms only after **Check these keys** verifies a real token with them. Changing a key switches protection off until the new keys pass.
   - **Server check:** each visitor's token is verified with the service on the server.
   - **If the service can't be reached,** the form is refused with an explanation, so nothing slips through during an outage.
   - **In the page builder,** a placeholder is shown instead, so no captcha service loads into the editor.
   - **Testing locally:** Cloudflare's Turnstile test keys always pass and work on localhost: site key `1x00000000000000000000AA`, secret key `1x0000000000000000000000000000000AA`.

Mention the captcha service in your privacy policy: it processes visitors' data to tell people from bots.

## Who can do what

| | Admin | Editor | Developer | Audit |
| --- | --- | --- | --- | --- |
| See forms | Yes | Yes | Yes | Yes |
| Create, edit, open or close, delete forms | Yes | Yes | Yes | No |
| Read responses | Yes | Yes | No | Yes |
| Download responses (CSV) | Yes | Yes | No | No |
| Spam protection settings | Change | No | Change | View |

## What it stores

Its own tables, all named `plugin_form_builder_*`, in the site's database (SQLite or PostgreSQL):

| Table | Holds |
| --- | --- |
| `plugin_form_builder_forms` | Each form: name, description, questions, settings, open or closed |
| `plugin_form_builder_responses` | Each response: the answers (each with the label and type it had), when it arrived, when it was first read. Deleted with its form |
| `plugin_form_builder_settings` | One row: the spam protection service, site key, sealed secret key, minimum score, on or off, and when the keys were last checked |

**What the CSV downloads contain:** spreadsheet-safe cells, so a cell can't run as a formula.

## For developers

The package on npm is compiled JavaScript with type declarations. The source is in [`plugins/form-builder`](https://github.com/muhammadarifftaha/pet-adopt/tree/main/plugins/form-builder) in the Pet Adopt repository.

| File | What it is |
| --- | --- |
| `src/index.tsx` | The plugin: screens, dashboard card, storage, email templates, and the Form block's loader (`blockLoaders`) |
| `src/names.ts` | The plugin's and the block's names, shared by both halves |
| `src/fields.ts` | The question model and its checks (`validateFormFields`, `validateFormSettings`, `validateAnswers`). Pure, also used in the browser |
| `src/server.ts` | The rules: forms, responses, CSV, sending a response, emails |
| `src/actions.ts` | Server actions for the admin screens, `listFormChoicesAction` for the Form block's picker, and `submitFormAction` for the visitor's form. Each checks permission through `host()` |
| `src/block.tsx`, `public-form.tsx`, `block-css.ts` | The page builder's **Form** block, the visitor's form it draws, and its CSS. Its loader is `loadFormBlock` in `src/server.ts` |
| `src/captcha.ts`, `captcha-providers.ts`, `captcha-widget.tsx` | Spam protection: settings and verification, the services, the visitor's widget |
| `src/email-templates.ts` | The two default templates |
| `src/storage.ts`, `schema/`, `migrations.ts`, `drizzle/` | Its tables and migrations. The SQL is inlined in `migrations.ts`, so the package needs no SQL files |
| `src/screens/` | Admin screens, built with `@pet-adopt/ui` |

**Entry points** (`package.json` `exports`):

| Import | Gives |
| --- | --- |
| `@pet-adopt/plugin-form-builder` | The plugin itself (server) |
| `@pet-adopt/plugin-form-builder/block` | `formBlock`, for `pet-adopt.blocks.ts` (loaded by the browser) |
| `@pet-adopt/plugin-form-builder/fields` | The question model |
| `@pet-adopt/plugin-form-builder/server` | The rules |
| `@pet-adopt/plugin-form-builder/actions` | The server actions |
| `@pet-adopt/plugin-form-builder/captcha` | The widget |

The Form block used to be built into the site. It keeps the same name (`FormBlock`) and options, so pages saved before the move still show their forms. [The plugin guide's page on blocks](https://github.com/muhammadarifftaha/pet-adopt/blob/main/apps/docs/content/docs/developers/plugins/blocks.mdx) uses it as an example of a plugin block.

**How it talks to the site:** it imports nothing from the app, only [`@pet-adopt/plugin-sdk`](https://github.com/muhammadarifftaha/pet-adopt/tree/main/packages/plugin-sdk) and the site's UI package. Everything it needs comes through `host()`:
- permissions;
- rate limits;
- the site's pet list;
- templated email;
- the activity log;
- encrypted secrets;
- the privacy policy.

**The compiled package** is made for a Pet Adopt site: Next.js bundles it, and the site's scripts load it with `tsx`. Files keep their `'use client'` and `'use server'` first lines.

### Working on it in the repository

Inside the Pet Adopt repository the package exports its TypeScript source and the app compiles it.

**After changing its tables:** edit both `schema/sqlite.ts` and `schema/pg.ts`, then run, from the repo root:

```bash
pnpm plugin:generate plugins/form-builder <change_name>
```

Commit `drizzle/` and the regenerated `migrations.ts`. Table and index names must start with `plugin_form_builder_`, and must not point at the site's own tables.

**Checks:** `pnpm typecheck` and `pnpm lint` cover this package. The end-to-end backend check (`pnpm check:backend` in `apps/web`) exercises forms, answers, limits, CSV, the spam trap, captcha and the Form block. The captcha's verify calls are answered by a fake there, so it needs no network.

**Building the package:** `pnpm pack` in this folder compiles `dist/` first (`build:package`) and writes the tarball. [The release runbook](https://github.com/muhammadarifftaha/pet-adopt/blob/main/apps/docs/content/docs/developers/contributing/releasing.mdx) says how it is published.

## Licence

MIT
