# Pet Adopt docs

The documentation site, built with [Fumadocs](https://fumadocs.dev) on Next.js. Pages are MDX files in `content/docs/`; each folder's `meta.json` sets its title and page order.

## Working on it

From the repository root:

```bash
pnpm install
pnpm dev:docs        # http://localhost:3001
```

`pnpm typecheck`, `pnpm lint` and `pnpm build` at the root include this app.

## Writing pages

- One `.mdx` file per page, with `title` and `description` in its front matter.
- Link to another page by its file path (`[blocks](../plugins/blocks.mdx)`): it is turned into the page's address. `<Card>` links are not, so give them the address (`/docs/developers/plugins/blocks`).
- The two sections, `admin/` and `developers/`, are root folders (`"root": true` in their `meta.json`): the sidebar shows one at a time, with a switcher at the top.
- Keep to plain Markdown where you can, so the file still reads well on GitHub. Fumadocs' `<Callout>` and `<Cards>` work without an import; other components would need one in `src/components/mdx.tsx`.
- `developers/plugins/theming.mdx`'s variable names are checked by `pnpm check:backend`: a variable described there must exist in the site's theme.

Every page is also served as Markdown for AI tools: `/docs/<page>.md`, plus `/llms.txt` (an index) and `/llms-full.txt` (everything).

## Deploying on Vercel

Create a Vercel project from this repository with:

| Setting | Value |
|---|---|
| Root Directory | `apps/docs` |
| Framework Preset | Next.js |
| Build and install commands | Leave the defaults: Vercel finds pnpm and the workspace from the repository root. |
| Ignored Build Step | `npx turbo-ignore` (skips a deployment when nothing the docs use has changed) |

The site needs no environment variables, no database and no outside service: search runs in the site itself.
