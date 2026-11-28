# Writing a plugin

A plugin adds features to a Pet Adopt site without changing the site's own code. This guide is for plugin authors.

A plugin imports one package, `@pet-adopt/plugin-sdk`, plus `@pet-adopt/ui` when it has admin screens. It never imports the site. Everything the site does for a plugin comes through the SDK.

Three plugins in this repository show the whole thing in code:

- [`plugins/adoption-tips`](../plugins/adoption-tips): the smallest useful plugin. It is an example to copy, and is not on npm.
- [`plugins/form-builder`](../plugins/form-builder): a full one, with tables, server actions, email, settings and the **Form** page builder block.
- [`plugins/instagram-feed`](../plugins/instagram-feed): a plugin built around one page builder block, the **Instagram feed**, which reads another service and keeps what it read in its own tables.

## Contents

- [What a plugin can add](#what-a-plugin-can-add)
- [The smallest plugin](#the-smallest-plugin)
- [Screens](#screens) and [dashboard cards](#dashboard-cards)
- [Access levels](#access-levels)
- [Storage](#storage)
- [Page builder blocks](#page-builder-blocks)
- [Host services](#host-services)
- [Errors](#errors)
- [The activity log](#the-activity-log)
- [Email](#email)
- [Styles](#styles)
- [Packaging for npm](#packaging-for-npm)
- [Local development](#local-development)
- [Checklist before publishing a plugin](#checklist-before-publishing-a-plugin)

## What a plugin can add

| Part | Key on the plugin | What it is |
|---|---|---|
| Screens | `screens` | Pages in the admin under `/admin/plugins/<name>/`, with a menu entry |
| Dashboard cards | `dashboardWidgets` | Cards on the admin dashboard |
| Its own tables | `storage` | Database tables with migrations, on SQLite and PostgreSQL |
| Page builder blocks | `blockLoaders`, plus a block module | Blocks in the page builder, under **Plugins**. See [Page builder blocks](#page-builder-blocks) |
| Default email templates | `emailTemplates` | Templates the site creates in **Email → Templates** and the plugin sends with |
| An email sender | `email` | Sends all of the site's email, in place of the built-in SMTP sender |

A plugin can also set `title` and `description`, which the admin shows in its list of plugins, and `plugins`, a list of other plugins it is built from. Those are loaded before it.

## The smallest plugin

```tsx
import { definePlugin } from '@pet-adopt/plugin-sdk'

export const hello = definePlugin({
  name: 'hello',
  title: 'Hello',
  description: 'Adds one screen to the admin.',
  screens: [
    {
      path: '',
      title: 'Hello',
      component: ({ user }) => <p>Hello {user.name}.</p>,
    },
  ],
})
```

The site lists it in `apps/web/pet-adopt.config.ts`:

```ts
import { defineConfig } from '@pet-adopt/plugin-sdk'
import { hello } from 'pet-adopt-plugin-hello'

export default defineConfig({ plugins: [hello()] })
```

- **`name`** is lowercase letters, digits and dashes. It is part of the plugin's addresses, and the start of its table names and activity log entries. Two plugins cannot share a name.
- **`definePlugin`** returns a function. The site calls it in the config.
- **Options:** pass a function to `definePlugin` to take options, as the form builder does with `formBuilder({ title: 'Applications' })`:

  ```tsx
  export const hello = definePlugin<{ greeting?: string } | void>((options) => ({
    name: 'hello',
    screens: [{ path: '', title: options?.greeting ?? 'Hello', component: () => null }],
  }))
  // in the config: hello({ greeting: 'Welcome' })
  ```

A mistake in a plugin (a bad name, path, icon, template, table or block) stops the site when the config loads, with a message that names the plugin.

## Screens

Each entry in `screens` is one page.

| Key | Meaning |
|---|---|
| `path` | The address under `/admin/plugins/<name>/`. `''` is the plugin's home screen |
| `title` | The page title, and the menu label unless `nav.label` is set |
| `component` | What to draw. It receives `user`, `params` and `searchParams` |
| `nav` | How it looks in the menu: `{ label?, Icon? }` |
| `hidden` | Leave it out of the menu. It is still reachable by its address |
| `access` | Who can open it. See [Access levels](#access-levels) |

- **Paths:** each segment is lowercase letters, digits and dashes, or a parameter such as `:id`. `items/:id` opened as `items/3` gives `params.id === '3'`.
- **The menu:** a screen appears in the sidebar's Plugins section unless it is `hidden` or its path has a parameter.
- **Matching:** when two screens could match an address, the one with fewer parameters wins. `items/new` beats `items/:id`.
- **No home screen:** a plugin without a `path: ''` screen gets a built-in overview page at `/admin/plugins/<name>`, for the roles that can see plugin settings (admins, developers and audit). It shows the description and what the plugin adds.
- **Components are server components.** They can be `async` and read data directly. For anything interactive, render a component from a file that starts with `'use client'`.
- **`user`** is the signed-in person: `id`, `email`, `name` and `role`.
- **Building screens:** use `@pet-adopt/ui`, the components the admin itself is made of (`@pet-adopt/ui/components/button`, and so on). See [Styles](#styles).

### Menu icons

`nav.Icon` takes one of two things:

1. **A react-icons icon:** `import { FiBookOpen } from 'react-icons/fi'`, then `nav: { label: 'Tips', Icon: FiBookOpen }`.
2. **SVG path data:** `{ viewBox?, paths, outline? }`.
   - `paths` is a list of 1 to 20 strings, each the `d` of a `<path>`.
   - `viewBox` defaults to `"0 0 24 24"`.
   - `outline: true` draws a 2 px outline. Without it the shape is filled.

   ```ts
   nav: { label: 'Hello', Icon: { viewBox: '0 0 24 24', paths: ['M12 2 2 22h20z'], outline: true } }
   ```

Anything else is refused when the config loads. Raw SVG markup is never accepted. A screen without an icon gets a standard one.

## Dashboard cards

```tsx
dashboardWidgets: [
  {
    id: 'tip-of-the-day',
    title: 'Tip of the day',
    component: ({ user }) => <p>Photos taken in daylight get more enquiries.</p>,
  },
]
```

- `id` is unique within the plugin.
- `component` receives `user`. It is a server component, like a screen.
- `access` works as it does for screens.

## Access levels

A screen or card sets `access`. The default is `all`.

| `access` | Can change | Can view only | Cannot open |
|---|---|---|---|
| `all` | Admin, editor, developer | Audit | |
| `admin` | Admin, developer | Audit | Editor |
| `personalData` | Admin, editor | Audit | Developer |

Use `personalData` for anything visitors sent, such as form responses.

The site checks `access` before it shows a screen, a menu entry or a card. **It cannot check your server actions.** Each action must check for itself.

### Checking in a server action

```ts
'use server'

import { accessPermission, host, type ActionResult } from '@pet-adopt/plugin-sdk'

export async function renameItemAction(id: number, name: string): Promise<ActionResult<void>> {
  return host().run(async () => {
    await host().requirePermission(accessPermission('all', 'edit'))
    // ... check the input, then make the change
  })
}
```

- **`accessPermission(access, 'view' | 'edit')`** gives the permission for a level. Use `'view'` for actions that read and `'edit'` for actions that change something. Audit accounts have every `view` permission and no `edit` permission.
- **`host().requirePermission(permission)`** returns the signed-in person, or throws a `UserError` when they lack the permission.
- **`host().run(fn)`** wraps the whole action. It returns `{ ok: true, data }`, or `{ ok: false, error, fieldErrors? }` when `fn` throws. See [Errors](#errors).
- **Check first.** Call `requirePermission` before reading the input or the database.
- **Showing or hiding a button:** `can(user.role, accessPermission('all', 'edit'))` answers without throwing. Hiding a button is not a check; the action still checks.
- **Public actions:** an action a visitor calls (sending a form) checks no permission. Limit it with `host().consumeAttempt` instead.

Call `host()` inside an action, a server component or a block loader, never at the top of a file. It only works inside a running site.

## Storage

A plugin can own database tables. The site creates and migrates them.

### Files

```
my-plugin/
  schema/sqlite.ts     the tables, for SQLite
  schema/pg.ts         the same tables, for PostgreSQL
  drizzle/             generated; commit it
  migrations.ts        generated; the plugin imports it
  src/storage.ts       definePluginStorage(...)
```

`src/storage.ts`:

```ts
import { definePluginStorage } from '@pet-adopt/plugin-sdk'

import { migrations } from '../migrations'
import * as pg from '../schema/pg'
import * as sqlite from '../schema/sqlite'

export const storage = definePluginStorage({ tables: { sqlite, pg }, migrations })
```

Pass `storage` to the plugin (`definePlugin({ name: 'my-plugin', storage, ... })`), and open the tables in server code:

```ts
const { db, t, withTransaction } = await storage.open()
const rows = await db.select().from(t.items)
```

- **Write queries once.** `t` is typed as the SQLite tables. On PostgreSQL it holds the PostgreSQL twins, so the same code runs on both.
- **Transactions:** `withTransaction(async (tx) => { ... }, { lock: 'my-plugin:items' })`. The `lock` makes transactions with the same name run one at a time.
- **`dialect`** (`'sqlite'` or `'pg'`) is there for the rare query that must differ.
- **`drizzle-orm` is a peer dependency** of a plugin with tables.

### Rules the site checks

The site checks these when the config loads, and refuses to start if one is broken:

- **The prefix:** every table and index name starts with `plugin_<name>_`, with the name's dashes turned into underscores. For `form-builder` that is `plugin_form_builder_`. `pluginTablePrefix(name)` returns it.
- **Twins:** `schema/sqlite.ts` and `schema/pg.ts` declare the same tables and columns.
- **No site tables:** a migration may only name tables and indexes with the plugin's prefix. So a plugin table cannot have a foreign key into one of the site's tables. Store the id as a plain column instead. Foreign keys between the plugin's own tables are fine.
- **Migration ids** look like `0000_init`, and are unique and in order.

Two more things to keep in mind:

- **Keep columns portable.** Use integer ids, JSON columns for lists, and plain text for options, so both databases behave the same.
- **Name long constraints yourself.** PostgreSQL cuts names at 63 characters, and a generated name with the prefix can be longer.

### Generating migrations

Never write `migrations.ts` by hand. After changing the schema files, run this from the root of the repository (or of a site, which is a clone of it):

```bash
pnpm plugin:generate <plugin folder> <change_name>
```

For example, `pnpm plugin:generate plugins/form-builder add_notes`.

- The folder is relative to where you type the command.
- The name is lowercase letters, digits and underscores. It becomes part of the migration's id.
- It runs drizzle-kit on both schema files, writes `drizzle/sqlite` and `drizzle/pg`, and then writes `migrations.ts` with the SQL of every migration inside it.
- It stops if the two databases' migrations do not pair up.
- The schema files may use relative imports only. drizzle-kit loads them without the site's path aliases.
- **Commit `drizzle/` and `migrations.ts`.** drizzle-kit compares against `drizzle/` to work out the next change.

**A migration that has shipped must never change.** The site keeps a checksum of each migration it ran, and refuses one that was edited or put out of order. To change a table, change the schema and generate a new migration.

### When migrations run

| Database | When |
|---|---|
| A local SQLite file | When the site opens the database, and with `pnpm migrate` |
| PostgreSQL, hosted libSQL | With `pnpm migrate`, and as part of `pnpm build` |

The site's own migrations run first, then each plugin's.

Until a plugin's migrations have run:

- its screens show a notice that says what to run;
- its dashboard cards are left out;
- `storage.open()` throws a `UserError` with a message for the owner;
- its block loaders give no data, so its blocks show what they show without data;
- the server prints a warning when it starts.

Removing a plugin from the config keeps its tables and data. There is no command that drops them.

## Page builder blocks

A plugin can add blocks to the page builder. They appear under **Plugins** in the list of blocks. Two plugins in this repository have one:

- **Form** (`plugins/form-builder/src/block.tsx`): picks one of the plugin's forms with a `choice` option, and draws the visitor's form, an interactive client component.
- **Instagram feed** (`plugins/instagram-feed/src/block.tsx`): many show and hide options, and a feed the plugin keeps in its own tables.

### The two halves

A block has two halves, because the page builder runs in the browser and a plugin's rules run on the server.

1. **The block** (`definePluginBlock` from the SDK): its name, label, options, defaults, `render` and optional `css`.
   - The browser loads it, so its module imports nothing that only works on a server: no storage, no `host()`, no secrets, no Node modules.
   - It may import a `'use client'` component (an interactive part `render` returns) and a `'use server'` actions file (for a `choice` option's `load`). Next.js sends the browser a reference to those, not their code.
   - The plugin exports it from an entry point of its own, such as `<package>/block`, and **never** from its main entry, which pulls in the server half.
2. **Its loader** (`blockLoaders: { [blockName]: loader }` on the plugin): a server function that returns what the block shows.
   - It runs for every visitor, and for the editor's preview, so it returns only what any visitor may see.
   - `render` receives the result as `data`. It is never saved with the page.

A site lists each half in its own file, in `apps/web`:

| File | Holds | Loaded by |
|---|---|---|
| `pet-adopt.config.ts` | The plugin (`defineConfig({ plugins: [...] })`): screens, storage, and the block's loader | The server |
| `pet-adopt.blocks.ts` | The blocks (`defineBlocks([...])`), imported from each plugin's block entry point | The browser and the server |

Both are needed. A block whose plugin is not in `pet-adopt.config.ts` stops the site at start, and a plugin with a loader for a block that `pet-adopt.blocks.ts` does not list gets a warning at start (pages that use that block do not show it).

### An example

A plugin `shelter-hours` with a block that shows opening hours kept in its own table.

`src/names.ts`, plain constants that both halves import:

```ts
export const PLUGIN = 'shelter-hours'
export const HOURS_BLOCK = 'ShelterHours'
```

`src/block.tsx`, the browser half:

```tsx
import { definePluginBlock } from '@pet-adopt/plugin-sdk'

import { HOURS_BLOCK, PLUGIN } from './names'

type Props = { heading: string; layout: 'list' | 'table' }
type Data = { days: Array<{ day: string; hours: string }> }

export const hoursBlock = definePluginBlock<Props, Data>({
  name: HOURS_BLOCK,
  label: 'Opening hours',
  plugin: PLUGIN,
  needsData: true,      // nothing to draw without hours
  dataOptions: [],      // the loader reads no option, so editing the heading never reloads it
  fields: {
    heading: { type: 'text', label: 'Heading' },
    layout: {
      type: 'radio',
      label: 'Layout',
      options: [
        { label: 'List', value: 'list' },
        { label: 'Table', value: 'table' },
      ],
    },
  },
  defaultProps: { heading: 'Opening hours', layout: 'list' },
  css: `
    .shelter-hours { padding: calc(48px * var(--density, 1)) 0; color: var(--ink); }
    .shelter-hours-day { color: var(--muted); font-weight: 700; }
  `,
  render: ({ heading, data, editing, headingLevel }) => {
    if (!data?.days?.length) {
      return editing ? <p className="shelter-hours">Add opening hours under Plugins, Shelter hours.</p> : null
    }
    const Heading = headingLevel === 1 ? 'h1' : 'h2'
    return (
      <section className="shelter-hours">
        {heading.trim() ? <Heading>{heading}</Heading> : null}
        <ul>
          {data.days.map((day) => (
            <li key={day.day}>
              <span className="shelter-hours-day">{day.day}</span> {day.hours}
            </li>
          ))}
        </ul>
      </section>
    )
  },
})
```

The CSS above is only a sketch; the variables a block can rely on are listed in [docs/theming.md](theming.md).

`src/server.ts`, the loader:

```ts
import { storage } from './storage'

export async function loadHours(): Promise<{ days: Array<{ day: string; hours: string }> } | null> {
  const { db, t } = await storage.open()
  const rows = await db.select().from(t.hours)
  return { days: rows.map((row) => ({ day: row.day, hours: row.hours })) }
}
```

`src/index.tsx`, the plugin, with the loader under the block's name:

```tsx
import { definePlugin } from '@pet-adopt/plugin-sdk'

import { HOURS_BLOCK, PLUGIN } from './names'
import { loadHours } from './server'
import { storage } from './storage'

export const shelterHours = definePlugin({
  name: PLUGIN,
  storage,
  blockLoaders: { [HOURS_BLOCK]: loadHours },
  screens: [/* where the team types the hours */],
})
```

`package.json` exports the block on its own (`"./block": "./src/block.tsx"`), and the site lists both halves:

```ts
// apps/web/pet-adopt.config.ts
import { shelterHours } from 'pet-adopt-plugin-shelter-hours'
export default defineConfig({ plugins: [shelterHours()] })

// apps/web/pet-adopt.blocks.ts
import { hoursBlock } from 'pet-adopt-plugin-shelter-hours/block'
export default defineBlocks([hoursBlock])
```

### The block's keys

| Key | Meaning |
|---|---|
| `name` | The block's type in saved pages: letters and digits, starting with a capital, at most 60 characters. Never change it, or saved pages lose the block |
| `label` | The name in the page builder's list of blocks |
| `plugin` | The plugin it belongs to (`Plugin.name`), which holds its loader |
| `fields` | Its options, shown in the page builder's sidebar. See [Options](#options) |
| `defaultProps` | A default for every option: text, a number, `true`, `false` or `null` |
| `needsData` | The block draws nothing without data |
| `headingFromData` | The block draws a heading whenever it has data |
| `dataOptions` | The options the loader reads |
| `petPage` | Also offer the block in the Pet page template |
| `css` | Plain CSS for the block |
| `render` | How it is drawn |

**Names are shared.** A block's `name` shares one list with the site's built-in blocks and every other plugin's blocks. Give it a prefix of your own (`AcmeGallery`, not `Gallery`). The site refuses to start when two blocks have one name.

### Options

| `type` | Extra keys | Saved value |
|---|---|---|
| `text`, `textarea` | | Text |
| `number` | `min`, `max`, `step` | A number, kept inside `min` and `max` |
| `select`, `radio` | `options: [{ label, value }]` | One of the `value`s (text, a number, `true` or `false`) |
| `choice` | `load`, `empty` | An id from the plugin's own list: text of at most 200 characters, or a number, or `null` |

- **A text option named `heading`** is the block's heading. Draw it whenever it is not blank: the page counts it when it decides which block holds the page's one `<h1>`.
- **Reserved names:** an option cannot be called `id`, `puck`, `editMode`, `padding`, `spacing`, `headingLevel`, `data`, `editing` or `pluginData`. The page builder and the site use those on every block.
- **Padding is added for you.** Every plugin block gets the same **Padding** option (top and bottom) as the built-in blocks.

**A `choice` option** is a dropdown filled by a server action of the plugin, such as the Form block's list of forms:

```ts
// src/actions.ts, a 'use server' file
export async function listFormChoicesAction(): Promise<ActionResult<PluginBlockChoice[]>> {
  return host().run(async () => {
    await host().requirePermission('pages:view')
    const forms = await listForms()
    return forms.map((form) => ({ label: form.name, value: form.id, ...(form.isOpen ? {} : { note: 'closed' }) }))
  })
}

// src/block.tsx
formId: { type: 'choice', label: 'Form', load: listFormChoicesAction, empty: 'Choose a form' },
```

- **The browser calls `load`,** so it checks a permission first. `pages:view` lets everyone who can open the page builder see the list.
- **It only reads.** It records no activity.
- **`note`** is shown in brackets after the label ("closed"). **`empty`** is the first entry's text while nothing is picked.
- **The list is read when the page builder opens.** A record changed elsewhere shows on the next reload.

**A number that cannot be typed.** The page builder's number box refuses every keystroke that lands outside `min` and `max`. With `min: 5, max: 10` nobody can type `10`, because its first digit is under the minimum, so a range of two-digit values only works with the arrows. Use a `select` with numeric values instead. The Instagram feed block does this for its number of posts (5 to 10):

```ts
options: [5, 6, 7, 8, 9, 10].map((n) => ({ label: String(n), value: n }))
```

### `needsData`, `headingFromData`, `dataOptions` and `petPage`

- **`needsData: true`:** the block draws nothing on the site without data from its loader. While it has none, its `heading` does not count as a heading of the page, so a page whose only heading would sit in an empty block still gets an `<h1>`. The Form block (a deleted form) and the Instagram feed block (no account connected) set it.
- **`headingFromData: true`:** the block draws a heading whenever it has data, even with a blank `heading` option. The Form block falls back to the form's name. The page then counts it as a heading while there is data, so the first such block can be the page's `<h1>`.
- **`dataOptions`:** the options the loader reads. The page builder then runs the loader again only when one of them changes (and when the block is first shown), and redraws with what it has for any other change. Without it, the loader runs after every change to the block, including each keystroke in a text option. An empty list says the loader reads no option. The public site always runs the loader. The Form block lists `['formId']`.
- **`petPage: true`:** the block is also offered in the Pet page template, the one layout that draws every pet's page. The loader is not told which pet is shown, so set it only for blocks that make sense on every pet's page. The Form block sets it, for an adoption application under every pet.

### `render`

`render` receives the block's options, checked, plus:

| Prop | Meaning |
|---|---|
| `data` | What the loader returned, or `null` (no loader, nothing returned, or it failed) |
| `editing` | `true` inside the page builder |
| `headingLevel` | `1` or `2`: the tag for the block's main heading on this page. Unset in the page builder; use `h2` then |

Rules:

- **A plain function of its props.** No hooks and no browser-only code: the same function draws the block on the server for visitors. For anything interactive, return a `'use client'` component (the component may use hooks; `render` itself may not). The Form block returns the visitor's form this way (`plugins/form-builder/src/public-form.tsx`).
- **Say why in the editor.** In the page builder (`editing`), a block with nothing to show draws a short note instead of vanishing. On the site it returns `null`.
- **Draw the heading with the tag `headingLevel` asks for**, so each page keeps exactly one `<h1>`.
- **A mistake stays in its block.** When `render` throws, the site leaves the block out and the page builder shows a note. That covers `render` itself, not a client component it returns.
- **Saved options are untrusted.** The site checks them against the block's fields before `render` sees them: a missing value or one of the wrong kind becomes the default, a number is kept inside its limits, and a `select` or `radio` value must be one of its choices. A `choice` may still name a record that no longer exists. Never put an option straight into a class name or a style; compare it against your own list first, as the Form block does with its background.
- **`data` is checked loosely.** Only an object or a list reaches `render` as `data`. Check its shape before you use it.

### `css`

- **Plain CSS, no Tailwind.** The page builder's canvas does not load Tailwind, so a block that used its classes would look different there than on the site. A block styles itself in `css`.
- **Use the site's theme variables** (`var(--primary)`, `var(--surface)`, `var(--radius)` and so on), so the block follows the site's theme and dark mode. [docs/theming.md](theming.md) lists them, with the colour pairs that are guaranteed to be readable together.
- **Not scoped.** The CSS is added to the page as written. Start every selector with a class of your own (`.fb-` for the form builder, `.shelter-hours` above).
- **Only when drawn.** It is added with each instance of the block that draws something; a block hidden on the site adds no CSS.

### The loader

```ts
export type PluginBlockLoader = (props: Record<string, unknown>) => Promise<unknown>
```

- **It gets the block's options,** checked the same way as `render`'s. Treat them as untrusted all the same: in the page builder the browser sends them.
- **Return plain JSON,** or `null` for nothing. The result crosses to the browser in the page builder. A result over about 1 MB is dropped.
- **It never breaks a page.** A loader that throws gives `null`, and the error is logged without its values. A plugin whose tables are not migrated gives `null` quietly.
- **Only public data.** Anyone who can see a page with the block sees what the loader returns.
- **Keep it fast.** It runs whenever a page with the block is drawn (pages are cached for about a minute). When it needs another service, keep a copy in your tables and refresh it now and then: the Instagram feed reads Instagram about once an hour and never while the site is being built.
- **The site may be building.** A loader can run during `pnpm build`, often with no database. Return `null` then, and do not log: the Form block checks `process.env.NEXT_PHASE === 'phase-production-build'`.
- **Declare one parameter.** A later SDK may pass a second argument, what the site knows about the page being drawn.

**After a change visitors should see** (a new feed, new opening hours), call `host().revalidateSite()` in the server action that made it. Without it, a page can show the old state for up to a minute.

## Host services

`host()` returns the site's services. All of them run on the server only.

| Service | What it is for |
|---|---|
| `requirePermission(permission)` | The signed-in person if they have the permission. Throws a `UserError` otherwise |
| `requireUser()` | Someone who can change plugin content (`pluginContent:edit`). Audit accounts are refused |
| `requireAdmin()` | Someone who can change plugin settings (`plugins:edit`): admins and developers |
| `run(fn)` | Runs an action and turns what it throws into an `ActionResult` |
| `clientAddress()` | The visitor's address as the site's proxy reports it, or `null` |
| `consumeAttempt(key, rule)` | A rate limit. Counts one attempt and throws a `UserError` past `rule.max` within `rule.windowMs`. Start the key with your plugin's name |
| `phone.validate(raw)` | `true`, or the reason a phone number cannot be used |
| `phone.toE164(raw)` | The number in international form (`+60123456789`), or `null` |
| `choices(source)` | Current choices from site data. `'pets'` gives the listed pets that are not adopted |
| `emailSender()` | The site's email sender, or `null` when the site cannot send email |
| `sendTemplatedEmail(message)` | Sends an email through one of the site's templates. See [Email](#email) |
| `emailTemplates(purpose)` | The templates of a purpose, for a "which template" choice |
| `recordActivity(entry)` | Adds an entry to the activity log. See [The activity log](#the-activity-log) |
| `privacyPolicy()` | The site's privacy policy while it is live, and where an admin chooses it |
| `timeZone()` | The site's time zone, or `null`. Pass it to `formatWhen` |
| `siteUrl()` | The site's public address, without a trailing slash |
| `revalidateSite()` | Asks the site to redraw its public pages after a change visitors see. Never throws; does nothing outside a request |
| `secrets.seal(plain, purpose)` | Encrypts a secret, such as an API key, before you store it |
| `secrets.open(sealed, purpose)` | Decrypts it, or returns `null` when it cannot be opened |
| `logError(error, context?)` | Logs an error safely. See [Errors](#errors) |

Notes:

- **Secrets:** a value only opens with the `purpose` it was sealed with. `open` returns `null` after the site's secret changes; ask for the secret again then. Never send a secret to a browser.
- **Privacy:** a plugin that collects personal data should warn while `privacyPolicy().policy` is `null`, and link to the policy where visitors type.
- **Times:** show every time with `formatWhen(value, timeZone, style)`, so all screens agree. `style` is `'dateTime'` (the default), `'date'` or `'longDate'`.

The SDK also exports helpers that need no site: `can`, `asRole`, `ROLES`, `ROLE_INFO`, `accessPermission`, `pluginTablePrefix`, `foldText` (text as searches compare it), `csvCell` (a CSV cell that a spreadsheet cannot run as a formula), `formatWhen`, `isTimeZone`, `dayInZone` and `startOfDayInZone`.

## Errors

Throw one of two classes when the person can fix the problem:

- **`ValidationError`** for bad input. It takes one message per field: `new ValidationError({ name: 'Give it a name.' })`.
- **`UserError`** for a broken rule: `new UserError('That form no longer exists.')`.

Inside `host().run`:

| Thrown | The action returns |
|---|---|
| `ValidationError` | `{ ok: false, error, fieldErrors }` |
| `UserError` | `{ ok: false, error }` with its message |
| Anything else | A general failure. The error is logged on the server |

Rules:

- **Messages are shown to people.** Write them for the person, and put no secret or internal detail in them.
- **Never log an error object yourself.** No `console.error(error)`. A failed database query carries the values it was given, which can be passwords, emails or whole records.
- **Use `host().logError(error, 'my-plugin: what was happening')`** when you catch an error and carry on. It logs what went wrong without those values.
- **Use the SDK's classes.** The site recognises errors by class. This is one reason the SDK is a peer dependency: a plugin with its own copy would have its errors treated as general failures.

## The activity log

The site keeps a log of who changed what. A plugin adds to it after a change succeeds:

```ts
await host().recordActivity({
  action: 'my-plugin.item.update',
  summary: 'Updated the item "Blue collar"',
  subject: { id: item.id, label: item.name },
  fields: ['name', 'price'],
})
```

- **`action`** is `<plugin name>.<thing>.<verb>`, in lowercase. It must start with the name of a plugin in the site's config, or nothing is recorded.
- **`summary`** is one sentence in the past tense.
- **`fields`** names what changed. **Never put values or personal data in an entry.**
- **Record** changes, and downloads of personal data. Do not record reads.
- It records the signed-in person. With nobody signed in, it records nothing.
- It never throws. A failure is logged and your change stands.

## Email

### Default templates

```ts
emailTemplates: [
  { key: 'notification', name: 'Order received', purpose: 'team-notification' },
]
```

- The site creates each one in **Email → Templates** when it starts. Owners can edit, rename and restore it, but not delete it.
- `key` is lowercase letters, digits and dashes. The template's full key is `<plugin name>:<key>`.
- `purpose` is `'team-notification'` (to the team) or `'visitor-message'` (to someone outside the team).
- `data` is an optional layout in the email builder's format. Without it, the site's built-in email of that purpose is used.

### Sending

```ts
const sent = await host().sendTemplatedEmail({
  purpose: 'team-notification',
  templateId: settings.templateId,   // the template the owner picked, if any
  fallback: 'my-plugin:notification',
  to: 'team@example.com',
  values: { title: 'Blue collar' },
  details: [{ label: 'Size', value: 'Medium' }],
})
```

- It resolves `false` when the site cannot send email, and rejects when sending fails.
- `details` are sent in team notifications only. A message to a visitor never repeats what someone typed, because anyone can type any address into a public form.
- `host().emailTemplates(purpose)` lists the templates an owner can pick from. Each has `id`, `name` and `seedKey`.
- **`emailTemplateUsage`** on the plugin is an optional function that reports where templates are used. The site shows it in the **Used by** column of **Email → Templates**.

### An email sender

A plugin with `email: { send, status? }` sends all of the site's email, for example through a provider's HTTP API where SMTP ports are blocked.

- `send(message)` gets `to`, `subject`, `text` and sometimes `html`. Throw when the message was not accepted.
- `status()` reports the setup for the plugin's page. While it says `ready: false`, the site uses its built-in SMTP sender, if that is set up.
- A site can have at most one such plugin.
- Never put a secret in `status().details`.

## Styles

A plugin draws in two places, styled two ways:

| Where | How to style it |
|---|---|
| **Admin screens and dashboard cards** | `@pet-adopt/ui` components and Tailwind classes, like the admin itself |
| **Page builder blocks** | Plain CSS in the block's `css`, on the site's theme variables. No Tailwind. See [`css`](#css) |

**Tailwind only writes the classes it finds.** A site lists where it looks in `packages/ui/src/styles/globals.css`, as `@source` lines:

- `plugins/` in the repository, for workspace plugins;
- `apps/web/node_modules/@pet-adopt/plugin-*/dist`, for npm plugins with that kind of name.

A plugin with any other name needs a line of its own. See [What the site adds](#what-the-site-adds).

**Theme variables:** [docs/theming.md](theming.md) lists the CSS variables the site guarantees, what each is for, which colour pairs are readable together, and an example of block CSS.

## Packaging for npm

A plugin on npm ships compiled JavaScript. The site does not compile packages installed from npm.

### Compile file by file with `tsc`

Use `tsc`, not a bundler. `tsc` writes one `.js` file for each source file, so a file that starts with `'use client'` or `'use server'` still starts with it after the build. Next.js needs that line first in the file. A bundler merges files, and the lines are lost.

`tsconfig.build.json`, beside the plugin's `tsconfig.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": false
  }
}
```

A plugin with tables includes `schema` and `migrations.ts` as well, with `"rootDir": "."` and `"include": ["src", "schema", "migrations.ts"]`. Its files then land in `dist/src/`. The form builder and the Instagram feed are built this way.

### `package.json`

```json
{
  "name": "pet-adopt-plugin-hello",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.tsx",
    "./block": "./src/block.tsx"
  },
  "files": ["dist"],
  "publishConfig": {
    "access": "public",
    "exports": {
      ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "./block": { "types": "./dist/block.d.ts", "default": "./dist/block.js" }
    }
  },
  "scripts": {
    "build:package": "node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\" && tsc -p tsconfig.build.json",
    "prepack": "pnpm run build:package"
  },
  "peerDependencies": {
    "@pet-adopt/plugin-sdk": "^0.1.0",
    "@pet-adopt/ui": ">=0.1.0",
    "react": "^19.2.0",
    "react-icons": "^5.7.0"
  }
}
```

- **`exports` and `publishConfig.exports`:** in a workspace, `exports` points at the TypeScript source, so the site compiles it and changes show at once. `publishConfig.exports` points at `dist`, and pnpm writes it into the package when it packs or publishes. So pack and publish with pnpm. A plugin that is never used from a workspace can point `exports` at `dist` directly.
- **A block has its own entry point** (`./block` above), because the browser loads it. Keep it out of the main entry's exports.
- **Clear `dist` first.** `build:package` deletes `dist` before `tsc` runs, as the packages in this repository do, so a file removed from the source is not shipped from an older build.
- **Peer dependencies:** the SDK and `@pet-adopt/ui` must be peer dependencies, so the plugin uses the site's copies. Add `drizzle-orm` when the plugin has tables, and `next` when it imports from `next/...`. List the same packages under `devDependencies` to build against. Inside this repository the SDK peer is written `workspace:^`, which pnpm turns into `^<version>` when it packs.
- **`@pet-adopt/ui`** is only needed by a plugin whose screens use it. It is not on npm: it is a workspace package inside every site (`packages/ui`). So a plugin that uses it must be built inside a workspace that has it, which means a site or this repository (see [Local development](#local-development)). Write its version as a wide range (`>=0.1.0`), not the current release: each site keeps the copy it started with, so a narrow range would warn on every older site. Also mark it optional (`"peerDependenciesMeta": { "@pet-adopt/ui": { "optional": true } }`): it is never on npm, so a required peer would warn on every install.
- **README and LICENSE:** npm adds them to the package whatever `files` says. Say in the README how a site installs the plugin (next section).
- **Check the result:** `pnpm pack --pack-destination <folder>` writes the tarball without publishing it. Look inside for `dist/`, for every address in `exports`, and for `'use client'` and `'use server'` on the first line of the files that had them.

### What the site adds

A site that installs an npm plugin does up to five things. Your README should list the ones your plugin needs:

1. **Install it** into the web app, from the site's root folder: `pnpm --filter @pet-adopt/web add <package>`.
2. **List the plugin** in `apps/web/pet-adopt.config.ts`.
3. **List its blocks,** if it has any, in `apps/web/pet-adopt.blocks.ts`, imported from the block entry point.
4. **Tell Tailwind to read it,** if it has admin screens. Tailwind does not look in `node_modules` by itself. `packages/ui/src/styles/globals.css` lists what it reads, as `@source` lines.
   - **A package named `@pet-adopt/plugin-*`** is covered already, by this line:

     ```css
     @source "../../../../apps/web/node_modules/@pet-adopt/plugin-*/dist";
     ```

   - **A plugin with any other name** needs a line of its own beside it:

     ```css
     @source "../../../../apps/web/node_modules/<package>/dist";
     ```

   Without it, the plugin's screens lose every class that nothing else on the site uses.
5. **Create its tables,** if it has any: `pnpm migrate` on PostgreSQL or hosted libSQL (`pnpm build` runs it too). A local SQLite file needs nothing.

Anything else the plugin needs belongs in its README as well. The Instagram feed, for example, needs the site to allow Instagram's picture hosts with `CSP_IMG_SRC`, because the site's content security policy allows pictures only from itself.

## Local development

A plugin kept as a folder works the same as one from npm, and needs no build. The site's Next.js compiles any dependency installed with `workspace:`, `link:` or `file:`.

### In this repository, or in a site

A site starts as a clone of this repository, so both have a `plugins/` folder that is already in `pnpm-workspace.yaml` and in the Tailwind `@source` lines.

1. Make a folder under `plugins/`, with a `package.json` whose `exports` points at the source (`"./src/index.tsx"`, plus `"./block": "./src/block.tsx"` for a block). Copy [`plugins/adoption-tips`](../plugins/adoption-tips) to start.
2. Run `pnpm install` at the root, so the new package gets its dependencies.
3. Add it to the web app, from the root:

   ```bash
   pnpm --filter @pet-adopt/web add <package name>@workspace:*
   ```

   Never run `pnpm add` at the root.
4. List it in `apps/web/pet-adopt.config.ts`, and its blocks in `apps/web/pet-adopt.blocks.ts`.
5. Run `pnpm dev`.

`pnpm typecheck` and `pnpm lint` cover a plugin that has those two scripts; copy `eslint.config.mjs` from the example plugin.

**After changing the plugin's tables,** run `pnpm plugin:generate plugins/<folder> <change_name>`, then restart `pnpm dev`. A local SQLite file applies the new migration when it opens.

### Trying a packed plugin

To try a plugin as a site would get it from npm, before publishing it:

1. `pnpm pack --pack-destination <a scratch folder>` in the plugin's folder.
2. In a site, `pnpm --filter @pet-adopt/web add <path to the .tgz>`.

A plugin installed from a tarball is compiled JavaScript, so it also needs an `@source` line for its `dist`, unless its name starts with `@pet-adopt/plugin-`.

## Checklist before publishing a plugin

- It imports `@pet-adopt/plugin-sdk` and, for screens, `@pet-adopt/ui`. Nothing from the site.
- Every server action is wrapped in `host().run` and checks a permission first.
- Every change is recorded with `host().recordActivity`, naming fields and never values.
- Errors are logged with `host().logError` only.
- Table and index names start with the plugin's prefix, and both schema files match.
- `drizzle/` and `migrations.ts` are committed, and no shipped migration was edited.
- Each block lives in a module the browser can load, exported from its own entry point, with a name that starts with something of your own.
- Each loader returns only public data, as plain JSON, and copes with options that name nothing.
- Block CSS uses the site's theme variables, and every selector starts with a class of your own.
- The packed tarball holds `dist/`, and client and server files keep their first line.
- The README tells a site how to install it: the config, the blocks file, the `@source` line when its name needs one, and `pnpm migrate`.
