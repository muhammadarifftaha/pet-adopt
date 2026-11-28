# Releasing

The maintainer's runbook for publishing Pet Adopt's npm packages, tagging the release and writing the GitHub release.

## What gets published

| Package | From | What it is |
|---|---|---|
| `@pet-adopt/plugin-sdk` | `packages/plugin-sdk` | What plugins and a site's config import |
| `@pet-adopt/plugin-form-builder` | `plugins/form-builder` | The form builder plugin, with the **Form** block |
| `@pet-adopt/plugin-instagram-feed` | `plugins/instagram-feed` | The Instagram feed plugin, with the **Instagram feed** block |

**Not published:**

- **The web app** (`apps/web`): a site is a clone of this repository.
- **`@pet-adopt/ui`** (`packages/ui`): every site keeps its own copy. Plugins take it as a peer dependency.
- **The example plugin** (`plugins/adoption-tips`): it stays in the repository for plugin authors to copy.

## Versions

- **The three packages share the project's version.** A release sets the same `version` in the root `package.json`, `apps/web`, `packages/plugin-sdk`, `plugins/form-builder`, `plugins/instagram-feed` and `plugins/adoption-tips` (not published, but kept in step).
- **The git tag is `vX.Y.Z`**, the same number.
- **Below 1.0,** a minor version (0.2.0) may need action from people who update. A patch version (0.1.1) never does. [`CHANGELOG.md`](../CHANGELOG.md) says the same to readers.
- **The plugins' range on the SDK follows by itself.** They name it as `workspace:^`, which pnpm writes as `^X.Y.Z` when it packs.
- **`@pet-adopt/ui` keeps its own version.** Each site's copy stays at the release the site was cloned from, so plugins peer on it as `>=0.1.0`, not on the current release; otherwise every older site would get a peer warning after each release. Raise that floor only when a plugin needs a component an older copy does not have, and say so under **Upgrading** in the changelog.

## What cannot be undone

Read this before every publish.

- **A version number can never be used again.** Once `0.1.0` of a package is on npm, that name and number are taken for good, even if the version is unpublished later. A mistake means publishing `0.1.1`.
- **Unpublishing is limited.** npm allows it freely only in the first 72 hours, and only while no other package depends on the version. After that it is allowed only for packages almost nobody uses. Do not plan on it.
- **`npm deprecate` is the usual remedy.** It leaves the version in place and shows a warning to anyone who installs it.
- **A published tarball is public at once.** Mirrors copy it within minutes. Treat a secret that was published as leaked, even after an unpublish.
- **A pushed tag that people have fetched** should not be moved. Fix forward with a new version.

The dry run exists so that none of this is needed. Run it every time.

## One-time setup on npmjs.com

Do this once, before the first release.

1. **Two-factor on the account.** Switch it on for the npm account that owns the packages, for sign-in and for publishing.
2. **The organisation.** The packages are scoped to `@pet-adopt`. Check that the organisation exists and that the publishing account is an owner of it.
3. **Publish the first version of each package by hand.** npm can only attach a trusted publisher to a package that already exists, so the workflow cannot publish a package's first version. See [The first release](#the-first-release).
4. **Attach the trusted publisher** to each of the three packages. On the package's page on npmjs.com, open **Settings**, then **Trusted publisher**, choose GitHub Actions, and enter:

   | Field | Value |
   |---|---|
   | Organisation or user | `muhammadarifftaha` |
   | Repository | `pet-adopt` |
   | Workflow filename | `publish-packages.yml` |
   | Environment | `release` |

   Renaming the workflow file or the environment breaks publishing until all three packages are updated.
5. **The `release` environment on GitHub.** In the repository's **Settings**, open **Environments** and check that `release` exists with:

   - **Required reviewers:** the maintainers who may approve a publish.
   - **Prevent self-review** off while there is a single maintainer; otherwise nobody can approve your own run.
   - **Deployment branches and tags:** selected branches, `main` only.

   A real publish then stops after **Pack and check** and waits for an approval. Read the packed file list and the tarball digest in that job before you approve. A dry run never asks.
6. **After that, publish only through the workflow.** It uses npm's trusted publishing, so no npm token is stored in the repository. Once the workflow has published successfully, set each package to require two-factor and refuse tokens, in the same settings page.

## Before each release

Work on a branch from `main`, with a clean working tree.

1. **Set the version** in every `package.json` listed under [Versions](#versions).
2. **Write the changelog entry** in [`CHANGELOG.md`](../CHANGELOG.md): rename the "not released yet" heading to the version and the date. Put anything that needs action under **Upgrading**.
3. **Run the checks,** from the repository root:

   ```bash
   pnpm typecheck
   pnpm lint
   pnpm check:schemas
   pnpm check:backend
   pnpm build
   ```

   Run `pnpm check:backend` twice: once on SQLite and once on PostgreSQL. It needs a throwaway database, the local storage and mail servers (`docker compose up -d garage mailpit`) and a few variables on its command line. The header of `apps/web/scripts/check-backend.ts` gives the command for each database. Never point it at a real site.
4. **Pack the packages by hand** if anything about packaging changed. In each package folder:

   ```bash
   pnpm pack --pack-destination <a scratch folder>
   ```

   `pnpm pack` builds `dist/` first (the `prepack` script). Open each tarball and check:

   - it holds `dist/`, a `README.md` and a `LICENSE` file, and nothing private (no `.env`, no `node_modules`);
   - its `package.json` has `exports` pointing into `dist/` and no `workspace:` range;
   - files that start with `'use client'` or `'use server'` in the source still start with it in `dist/`.

5. **Try the packed plugins in a site,** before anything is on npm. In a scratch clone of the repository, make it look like a site that installs them from npm:

   - Delete `packages/plugin-sdk`, `plugins/form-builder`, `plugins/instagram-feed` and `plugins/adoption-tips` (the example plugin would keep the workspace SDK and give the site two copies of it).
   - Remove `adoptionTips()` from `apps/web/pet-adopt.config.ts`, and `@pet-adopt/plugin-adoption-tips` from `apps/web/package.json`.
   - Delete `apps/web/scripts/check-backend.ts` (it imports the plugins' source, which a site from npm does not have).
   - In `apps/web/package.json`, set the three `@pet-adopt/plugin-*` dependencies to `^X.Y.Z`.
   - Point pnpm at the tarballs, under `overrides:` in `pnpm-workspace.yaml`:

     ```yaml
     overrides:
       "@pet-adopt/plugin-sdk": "file:<scratch folder>/pet-adopt-plugin-sdk-X.Y.Z.tgz"
       "@pet-adopt/plugin-form-builder": "file:<scratch folder>/pet-adopt-plugin-form-builder-X.Y.Z.tgz"
       "@pet-adopt/plugin-instagram-feed": "file:<scratch folder>/pet-adopt-plugin-instagram-feed-X.Y.Z.tgz"
     ```

   - Run `pnpm install`. pnpm warns about an unmet `@pet-adopt/plugin-sdk` peer because the version shows as a file path; that is expected here.

   Then `pnpm build` and `pnpm start`, and open the admin: **Forms** and **Instagram** should be styled, and both blocks should be in the page builder. The tarballs are compiled JavaScript, so this is what a site gets from npm.

   - **To check the styles for real,** delete the line `@source "../../../../plugins";` from `packages/ui/src/styles/globals.css` in the scratch clone first. Otherwise Tailwind still finds the class names in the plugins' source, and a missing `@source` line for `node_modules` would go unnoticed.
6. **Merge to `main`** and wait for CI to pass.
7. **Run the publish workflow's dry run for each package.** In GitHub, open **Actions**, choose **Publish packages** (`.github/workflows/publish-packages.yml`), and run it from `main` with **Dry run** left on, once for each of the three packages. It installs, typechecks, packs and checks the package, and publishes nothing. Read the list of files it prints, and the summary line with the version.

## The order of a release

Publish in this order. Each step depends on the one before it.

1. **`@pet-adopt/plugin-sdk`.** Both plugins take it as a peer dependency.
2. **`@pet-adopt/plugin-form-builder`.**
3. **`@pet-adopt/plugin-instagram-feed`.** The two plugins do not depend on each other; this order is only to keep it the same every time.
4. **The git tag:**

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

5. **The GitHub release.** Create it from the tag, and paste that version's section of `CHANGELOG.md` as its notes.

For each package, run the publish workflow from `main` with **Dry run** switched off. It refuses a version that is already on npm. When **Pack and check** has passed, the run waits on the `release` environment: check its file list and digest, then approve it under **Review deployments**. After each one, check the package's page on npmjs.com before starting the next.

**If a step fails part-way,** stop. The packages already published stay published. Fix the problem, and publish the remaining packages at the same version if they were never published. If a published package is itself wrong, bump every package to the next patch version and start the order again.

## The first release

The first version of each package is published by hand, from a clean checkout of `main` at the commit to be released, in the same order: the SDK, then the form builder, then the Instagram feed.

For each package:

```bash
cd <package folder>
pnpm pack --pack-destination <a scratch folder>
npm publish <a scratch folder>/<the tarball>.tgz --access public
```

- **Pack with pnpm, publish the tarball with npm.** pnpm builds the package (`prepack`), writes the compiled `exports` from `publishConfig`, and turns `workspace:` ranges into real ones. Running `npm publish` in the folder itself would skip all three.
- **Sign in first** with `npm login`. npm asks for a two-factor code when it publishes.
- **`--access public` is required** the first time: a scoped package is private by default.
- **Check the package's page** on npmjs.com after each one.

Then:

1. Attach the trusted publisher to each package (step 4 of the one-time setup).
2. Tag `v0.1.0`, push the tag, and create the GitHub release.
3. Delete the "Not published yet" notes. Find them with:

   ```bash
   grep -rn "Not published yet" --include='*.md' --exclude-dir=node_modules .
   ```

   They are in `README.md` and in the READMEs of the published packages. Leave the lines in this file alone.

## After a release

- **Install from npm in a scratch site.** In a fresh clone, swap the workspace plugins for the published ones (see "Installing" in each plugin's README), then build, start and open the admin. This is the path site owners take.
- **pnpm can hold back a brand-new version** for a while after it is published (its `minimumReleaseAge` setting). If a site does not pick up the new version, name it: `pnpm --filter @pet-adopt/web add @pet-adopt/plugin-form-builder@X.Y.Z`, and look at what `pnpm-lock.yaml` recorded.
- **Check each package's page** on npmjs.com: the README, the version, and the provenance badge (the workflow publishes with `--provenance`).
- **Open the next changelog section** (`## X.Y.Z (not released yet)`) when the next change lands.
