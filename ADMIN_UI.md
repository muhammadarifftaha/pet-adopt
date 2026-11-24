# Admin UI: what to build

The backend is done and tested. This is the list of screens and components for the admin, with the
server actions each one calls. Everything lives under `/admin` (a new `src/app/(admin)` route group;
the old Payload admin is gone, so `/admin` currently 404s).

Already in place, so you can build on it:

- shadcn/ui is installed site-wide (`components.json`, `src/components/ui/`, `src/app/globals.css`).
  Add components with `pnpm dlx shadcn@latest add <name>`.
- shadcn's colours are bridged to the site theme in `globals.css`, so components follow the chosen
  preset and light/dark mode automatically. The site's own `--muted` is a *text* colour; shadcn's
  `bg-muted` maps to `--surface-alt`.
- The page builder at `/edit/[id]` (Puck) is unchanged and signed-in only.

## Rules every screen follows

- **Calling the backend.** Import the actions from `src/server/actions/*` and call them from client
  components or `<form action>`. They are plain async functions, so there is no REST API.
- **Result shape.** Every action returns `{ ok: true, data }` or
  `{ ok: false, error, fieldErrors? }` (`ActionResult` in `src/server/result.ts`). Show `error` in a
  toast or alert; show each `fieldErrors[name]` under its input. Nested keys use dots:
  `customTheme.light.text`, `nav.0.href`, `socials.1.url`.
- **Partial updates.** Send only the keys you are changing. A key that is left out stays as it is;
  an empty string clears it.
- **Auth guard.** In the `(admin)` layout call `getSessionUser()` (`src/server/session.ts`) and
  `redirect('/admin/login')` when it is `null`. Hide admin-only links when `user.role !== 'admin'`;
  the actions enforce it anyway.
- **Roles.** `admin`: everything. `editor`: pets, pages, media, and their own name and password.
  Settings and Users are admin-only.
- **Layout needs.** The `(admin)` root layout must render `<html>` and `<body>`, import
  `../globals.css` and `../(frontend)/fonts`, and render `<ThemeStyle settings={...} />` in `<head>`
  (see `src/app/(editor)/layout.tsx`) so the theme variables exist.
- **Redirects the existing code expects:** `/admin/login?redirect=/edit/3` after sign-in, and the
  builder's "Page settings" link goes to `/admin/pages/[id]`.

## Screens

### 1. Shell
- [ ] Root layout (see above), sidebar or top nav: Pets, Pages, Media, Settings, Users. (Account is in the user menu in the header.)
- [ ] Current user menu with name, role badge and **Sign out** (`signOutAction`).
- [ ] Toaster for success and error messages (shadcn `sonner`).
- [ ] Confirm dialog for every delete (`alert-dialog`).
- [ ] Loading skeletons and empty states for each list.

### 2. Sign in `/admin/login`
- [x] Email and password form → `signInAction({ email, password })`, then go to `?redirect=` or `/admin`
      (the page passes the target through `safeRedirectPath`, so it is always a path on this site).
- [x] Show the returned error as is. It already says "Incorrect email or password." or how long a
      lockout lasts (5 wrong tries lock an email for 10 minutes).
- [x] If already signed in, redirect to `/admin`.

### 2b. Reset password `/admin/reset-password` (done)
- No `?token=`: "email me a link" (`requestPasswordResetAction({ email })`) when an email plugin is
  registered, otherwise a note to ask an admin. The answer is the same whether or not the account exists.
- `?token=...`: new password form (`resetPasswordWithTokenAction({ token, password })`), or "this link
  no longer works" (one use, one hour). Saving ends every session of that person.

### 3. Pets
List `/admin/pets`
- [ ] Table with cover thumbnail, name, species, status badge, featured / unlisted / urgent flags,
      location, updated. `listPetsAction({ search, status, species, page })` (12 per page,
      includes unlisted pets).
- [ ] Search box, status and species filters, pagination (`hasNextPage`, `totalPages`).
- [ ] Row actions: edit, open public page (`/pets/{slug}`), delete (`deletePetAction`).

Form `/admin/pets/new` and `/admin/pets/[id]` (`getPetAction`, `savePetAction(id | null, input)`)
- [ ] Tabs: **Basics**, **Health and behaviour**, **Photos and story**, **Adoption**, **SEO**.
- [ ] Sidebar: status, featured, unlisted ("link only"), urgent, slug (blank = generated from name),
      adoption date (read-only, set automatically).
- [ ] Field names and limits:

| Tab | Fields |
| --- | --- |
| Basics | `name` (required, 60), `species` (required), `sex`, `breed` (80), `size`, age (see "Age" below), `color` (60), `city` (60), `state` (60), `location` (120) |
| Health and behaviour | `vaccinated`, `neutered`, `microchipped`, `houseTrained`, `specialNeeds`, `healthNotes` (500), `temperament[]`, `goodWith[]` |
| Photos and story | `photoIds[]` (required, 1 to 10, first is the cover), `description` (rich text document, 5000 visible characters, same editor as health notes; plain text is still accepted and becomes one paragraph per line), `videoUrl` (https only) |
| Adoption | `adoptionFee` (0 or more), `rescuedAt` (YYYY-MM-DD), `contactWhatsApp` |
| SEO | `seoTitle` (70), `seoDescription` (160), `seoImageId` |
| Sidebar | `status`, `featured`, `unlisted`, `urgent`, `slug` |

- [ ] Option lists for the selects are in `src/lib/options.ts` (`SPECIES`, `STATUSES`, `SEXES`,
      `AGE_GROUPS`, `AGE_UNITS`, `SIZES`, `TEMPERAMENTS`, `GOOD_WITH`).
- [ ] **Age.** The owner enters it once and it keeps up with the calendar, because it is stored as a
      birth date. Offer two ways, as a toggle or two fields:
      - "Born on" -> send `birthDate` (`YYYY-MM-DD`, not in the future).
      - "About [number] [weeks | months | years] old" -> send `ageValue` (a whole number, 1 to 200)
        and `ageUnit` (`weeks`, `months` or `years`). The server turns it into an estimated birth
        date and sets `birthDateEstimated`, and the site then shows "About 8 months".
      Send only what the owner changed: sending `ageValue` again re-estimates from today, so on
      an edit send the age fields only when the owner touches them. Saving the same `birthDate`
      again leaves an estimate flagged as an estimate. A blank `birthDate` next to an age means "use
      the age"; `birthDate: null` on its own clears it. Errors come back on `birthDate`, `ageValue`
      or `ageUnit`.
      The pet's `ageDescription` and `ageGroup` are worked out from the birth date when there is
      one (read them for display), and are the owner's own text and pick otherwise. Keep the
      optional "Age description" text (40) and "Age group" select for a pet whose age nobody knows;
      they are ignored once a birth date exists.
- [ ] City and state: typing them rebuilds `location` as "City, State" on save. Hint that spelling
      should be consistent, because the catalog filters match exactly.
- [ ] Photo field: pick from the media library, drag to reorder, remove (see Media picker below).
- [ ] After a successful create, go to `/admin/pets/{id}`. On `fieldErrors`, switch to the tab that
      holds the first error.

### 4. Pages
List `/admin/pages` (`listPagesAction`)
- [x] Table (`PagesTable`, TanStack Table v9): ID, title (links to settings), path, live link
      (published only), status (Draft / Published / Archived, plus "unpublished changes"); sortable.
- [x] Row actions: **Edit** (`/edit/{id}`) and **Archive** (`archivePageAction`); once archived,
      **Restore** (`restorePageAction`) and **Delete** (`deletePageAction`, confirm dialog). The server
      refuses to delete a page that is not archived, and refuses edits to an archived one.
- [x] Opening a row (`PageDetails`): preview iframe of `/edit/{id}/preview` and the versions list
      (`listPageVersionsAction`), each with View (`/edit/{id}/preview?version=N`) and "Use as draft"
      (`restorePageVersionAction(id, number, baseVersion)`).

Settings `/admin/pages/new` and `/admin/pages/[id]` (`getPageAction`, `savePageDetailsAction`)
- [ ] Fields: `title` (required), `slug` (required; `home` is the homepage; reserved words are
      rejected with a message), `seoDescription` (200), `seoImageId`.
- [ ] Buttons: **Open page builder**, **Publish** (`publishPageAction(id)`, publishes the saved
      draft), **Unpublish** (`unpublishPageAction`), **Archive** (`archivePageAction`). Delete lives in
      the list, for archived pages only.
- [ ] New page: after saving, offer "Open page builder" (a page with no layout cannot be published).

### 5. Media `/admin/media`
- [ ] Grid of thumbnails (`thumbnailUrl`), alt text, size, "used by" on the detail view
      (`getMediaAction(id)` returns `usage`). `listMediaAction({ page, search })`.
- [ ] Upload: `uploadMediaAction(formData)` with fields `file` and `alt` (alt text required, JPEG,
      PNG, WebP, AVIF or GIF, up to 10 MB). Drag and drop plus a file picker, with progress and the
      returned `fieldErrors.file` / `fieldErrors.alt`.
- [ ] Edit alt text (`updateMediaAltAction`), delete (`deleteMediaAction`). Deleting an image that
      pets, pages or the logo still use is refused; show the message, it says where.

### 6. Media picker (reusable dialog)
- [ ] Used by the pet photos, SEO share images and the logo. Browse and search the library, upload a
      new image without leaving the form, single or multiple selection.
- [ ] The Puck editor has its own picker (`src/puck/media-picker.tsx`); leave it alone.

### 7. Site settings `/admin/settings` (admin only) — done (`SettingsForm`, schema in `src/lib/zod-schema/settings.ts`; `primaryColor` is no longer in the form, the Theme screen owns the look)
`getSettingsAction`, `updateSettingsAction(input)`. Tabs:
- [x] **Brand:** `siteName` (required), `tagline`, `logoId` (any shape; site header and admin sidebar), `faviconId` ("Site icon": square within 5%, at least 32 px, checked on the server as `faviconId`), `primaryColor` (optional hex override).
- [x] **Theme:** moved to its own screen, `/admin/theme` (theme library and editor, done). The old (`PRESET_OPTIONS`, `PRESET_HELP` in `src/lib/theme.ts`; swatch
      cards or a live preview would help), `allowModeToggle`, `customize` switch, and when on,
      `customTheme`: `headingFont`, `bodyFont`, `radius`, `button`, `shadow`, `density`, `textSize`,
      and `light` / `dark` colour sets (`primary`, `background`, `surface`, `text`, `tint`). Colours
      are hex; the server rejects text that is hard to read and reports it as
      `customTheme.light.text` / `customTheme.dark.text`.
- [x] **Contact:** `whatsappNumber`, `whatsappMessage` (`{pet}` is replaced by the pet's name),
      `address`, `openingHours`, `socials[]` (`platform` + https `url`, add / remove / reorder).
- [x] **Navigation:** `nav[]` (`label` + `href`, a path such as `/pets` or an https link),
      `footerText`.

### 8. Users `/admin/users` (admin only)
- [ ] List (`listUsersAction`): name, email, role, created.
- [ ] "Reset link" per user (`createResetLinkAction(id)` → `{ url, expiresAt }`): show the link with a
      copy button and when it expires, for the admin to send by WhatsApp or anything else. Making a
      new link cancels the older one. Works with or without an email plugin.
- [ ] Create (`createUserAction({ email, name, password, role })`). Password minimum is 12
      characters in production, 8 in development. The first account is always an admin.
- [ ] Edit name and role (`updateUserAction(id, { name, role })`), reset password
      (`resetUserPasswordAction(id, { password })`, signs that person out everywhere), delete
      (`deleteUserAction`). The last admin cannot be demoted or deleted; the message says so.

### 9. Account `/admin/account` (everyone)
- [ ] Change name (`updateProfileAction({ name })`).
- [ ] Change password (`changePasswordAction({ currentPassword, newPassword })`); signs out other
      devices.

### 10. Dashboard `/admin` (optional)
- [ ] Counts (pets by status, pages, media) and shortcuts ("Add pet", "New page"). There is no
      dedicated action; call `listPetsAction({ status, limit: 1 })` and read `totalDocs`.

## Reusable components to extract
- [ ] `FormField` (label, hint, error from `fieldErrors`), plus a helper that turns an
      `ActionResult` into toasts and field errors.
- [ ] `ConfirmDelete`, `StatusBadge`, `DataTable` with pagination, `EmptyState`.
- [ ] `ColorInput` (hex text with swatch), `ListEditor` (add / remove / reorder rows) for socials and nav.

## Quality checks
- [ ] Keyboard and screen-reader pass on forms and dialogs (labels, focus order, error announcements).
- [ ] Mobile widths: tables become cards or scroll, sidebar collapses.
- [ ] Dark mode follows the site toggle (`data-mode="dark"` on `<html>`).
- [ ] Look at the admin with DevTools open for CSP violations (`CSP_REPORT_ONLY=1` helps); any
      new external resource needs a directive in `next.config.ts`.

## Public site follow-ups (from CLAUDE.md, still yours)
- [ ] Show the newer pet fields on the pet page and cards (`birthDate`, `color`, `microchipped`,
      `houseTrained`, `specialNeeds`, `healthNotes`, `temperament`, `goodWith`, `videoUrl`,
      `adoptionFee`, `rescuedAt`, `urgent`). `getPetBySlug` returns all of them;
      `contactWhatsApp` should override the site number on that pet's button.
- [ ] City and state filters on the catalog, fed by `getLocationOptions()`.
