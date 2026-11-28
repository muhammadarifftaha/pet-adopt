# Theming for plugin authors

How to style a plugin's page builder block so that it follows each site's theme: its colours, corners, fonts, spacing, and light and dark mode.

A site's owners pick and adjust a theme on the **Theme** screen. The site writes the result into every page as CSS variables on `<html>`. The public site and the page builder's canvas load no Tailwind, so a block brings its own plain CSS (the `css` of `definePluginBlock`, see [Plugins](plugins.md)), and that CSS reads these variables.

The variables below are the contract. Their names stay as they are, and the site's `check:backend` fails if one of them goes missing from any built-in preset, in light or dark mode. The list lives in code as `THEME_VARIABLES` in `apps/web/src/lib/theme.ts`, which this page follows.

## How it works

- **Every value is a variable.** Write every colour, radius, shadow, font and spacing value in your block's CSS with one of the variables below. A colour typed into the CSS will be wrong on some site, and unreadable in one of the two modes.
- **Dark mode is handled for you.** When a page is dark (the visitor's system setting, or the light/dark switch on the site), the site gives every colour and shadow variable its dark value. Do not write `@media (prefers-color-scheme: dark)` or `[data-mode]` rules: the same CSS works in both modes. The page builder's **Dark preview** switch shows the dark values on the canvas.
- **Some sites have no dark mode.** When the owners turn the light/dark switch off, the page always uses the light values. Your CSS does not need to know.
- **The values come from the owners.** Besides the five built-in presets, owners can make themes of their own with their own colours, fonts, corners and spacing. The contrast promises below say how far each pair holds for those.

## The variables

"Dark" says whether dark mode gives the variable another value.

### Surfaces and text

| Variable | Use it for | Dark |
|---|---|---|
| `--bg` | The page background. | Yes |
| `--surface` | Cards, panels and inputs that sit on the page. | Yes |
| `--surface-alt` | A quieter panel: notes, empty states, alternating rows. | Yes |
| `--tint` | A soft wash of the brand colour for a highlighted section. | Yes |
| `--placeholder` | The fill behind an image that has not loaded or is missing. | Yes |
| `--ink` | Body text and headings. | Yes |
| `--muted` | Secondary text: captions, hints, dates. | Yes |
| `--line` | Hairline borders and dividers. Decoration only, never text. | Yes |
| `--line-strong` | Borders that must show: inputs, outlined boxes. | Yes |

### Brand

| Variable | Use it for | Dark |
|---|---|---|
| `--primary` | The brand colour as a fill: solid buttons, active marks. | Yes |
| `--on-primary` | Text and icons on a `--primary` fill. | Yes |
| `--primary-text` | The brand colour as text: links, outlined buttons, focus rings. | Yes |

Brand colours are often too light to read as text, which is why there are two: fill with `--primary`, write with `--primary-text`.

### The dark band

| Variable | Use it for | Dark |
|---|---|---|
| `--band-bg` | A dark band across the page, like the site's footer. Dark in both modes. | Yes |
| `--band-ink` | Text on `--band-bg`. | Yes |
| `--band-link` | Links on `--band-bg`. | Yes |

### Status pairs

Each pair is a background and the text colour made for it. Always use the two together.

| Variable | Use it for | Dark |
|---|---|---|
| `--ok-bg` | Background of a good-news badge or notice ("Available"). | Yes |
| `--ok-ink` | Text on `--ok-bg`. | Yes |
| `--warn-bg` | Background of a caution badge or notice ("Pending"). | Yes |
| `--warn-ink` | Text on `--warn-bg`. | Yes |
| `--neutral-bg` | Background of a plain badge or label ("Adopted", a count). | Yes |
| `--neutral-ink` | Text on `--neutral-bg`. | Yes |

### Depth

| Variable | Use it for | Dark |
|---|---|---|
| `--shadow-card` | The resting shadow of a card. Can be `none`. | Yes (stronger, so it still shows) |
| `--shadow-hover` | The shadow of a card under the pointer. Can be `none`. | Yes |

Some themes have no shadows at all, and one ("Hard offset") draws a solid offset edge in the text colour. Do not rely on a shadow to show where a card ends: give it a `--line` or `--line-strong` border, or a `--surface` background on `--bg`, when that matters.

### Shape

| Variable | Use it for | Dark |
|---|---|---|
| `--radius` | Corner radius of cards and large boxes. | No |
| `--radius-sm` | Corner radius of small parts: images in a grid, inputs, chips. | No |
| `--radius-btn` | Corner radius of buttons (`999px` for pill buttons). | No |
| `--radius-badge` | Corner radius of badges and tags. | No |

Any of them can be `0px`: some themes have square corners.

### Type

| Variable | Use it for | Dark |
|---|---|---|
| `--font-body` | The font stack for body text. | No |
| `--font-heading` | The font stack for headings. | No |
| `--heading-weight` | The font weight of headings (a number, such as `700`). | No |
| `--font-size-root` | The root text size (15, 16 or 18 px). | No |

The page's `html` already uses `--font-size-root` and `body` uses `--font-body` and `--ink`, so a block inherits them. Size text in `rem` (or `em`) so it follows the owners' text size; do not set pixel font sizes.

### Spacing

| Variable | Use it for | Dark |
|---|---|---|
| `--density` | A spacing multiplier: 0.8 (compact), 1 (comfortable) or 1.25 (spacious). | No |

Write every padding, margin and gap as a length times the density: `calc(16px * var(--density))`. The site's own sections do the same, so your block keeps the same rhythm as the blocks around it. Border and outline widths stay plain values (`1px`, `2px`).

## Contrast you can count on

These pairs reach at least **4.5:1** (WCAG 2.2 AA for normal text) on every built-in preset, in light and dark. `check:backend` checks each one on every preset.

| Text | On | For custom colours |
|---|---|---|
| `--ink` | `--bg`, `--surface` | Always: the Theme screen refuses to save colours that fall short. |
| `--muted` | `--bg`, `--surface`, `--surface-alt`, `--tint` | The site darkens or lightens it until it reaches 4.5:1 on all four. |
| `--primary-text` | `--bg`, `--surface`, `--surface-alt`, `--tint` | The same: adjusted until it reaches 4.5:1 on all four. |
| `--on-primary` | `--primary` | White or near-black, whichever reads better. For a mid-tone brand colour that can come out a little lower, down to about 4.3:1. |
| `--band-ink` | `--band-bg` | Holds when the colours are the usual way round: dark text on a light page in light mode, a dark page in dark mode. |
| `--band-link` | `--band-bg` | The site adjusts it until it reaches 4.5:1. |
| `--ok-ink` | `--ok-bg` | Always: fixed colours. |
| `--warn-ink` | `--warn-bg` | Always: fixed colours. |
| `--neutral-ink` | `--neutral-bg` | Always: fixed colours. |

Nothing else is promised. In particular:

- **Do not put `--ink` or `--muted` on `--primary`**, or `--primary-text` on `--primary`. Use `--on-primary` there.
- **Do not put body text on `--band-bg`** except `--band-ink` and `--band-link`.
- **Borders have no promised ratio.** `--line` is decoration. An input's border, or anything a person needs to see to use the block, takes `--line-strong`, and its state (focus, selection) should show in more than colour alone: an outline, a thicker border, an icon or text.
- **Focus rings** use `--primary-text` at full strength, as the site does: `outline: 2px solid var(--primary-text); outline-offset: 2px;`.
- **Text over a photo** has no theme colour that is sure to read. The site puts white text over photos only behind a dark overlay; do the same, or keep the text off the picture.

## Writing a block's CSS

- **Start every selector with a class of your own** (`.acme-notice`, `.acme-notice-title`). The CSS is added to the page as written, not scoped, so a bare `p` or `.title` would restyle the whole site.
- **Use only the variables above** for colours, corners, shadows, fonts and spacing. A block may set variables of its own for its own sizes (`--acme-photo: 96px`), as long as their names carry your prefix.
- **Use plain `@media` width rules** for narrow screens. The page builder's canvas is a frame at the chosen width (Phone 390 px, Tablet 768 px, Laptop 1280 px), so the rules apply there too. The site's own blocks change at 800 px and 480 px.
- **You may use the site's own classes** for the parts every block shares: `section` (vertical padding that follows `--density`), `container` (the page's width and side gutters), `block-heading` (a section heading), `item-heading` (a card title), `btn` with `btn-primary` or `btn-outline` (buttons), and `muted`. They come from the site's stylesheet. They are not part of the checked contract like the variables are, but the built-in plugins use them, so they will not change lightly.
- **A fallback is allowed but not needed.** The site's stylesheet declares every variable too (the "Sunrise" look), so `var(--density)` always has a value. Writing `var(--density, 1)` does no harm.
- `--container` and `--pad-scale` appear in the site's stylesheet but are not theme variables: use the `container` class instead of reading them.

## Example

A notice card with a title, a short line of secondary text, a status badge and a link. It reads in light and dark, follows the corners, fonts and spacing of any theme, and stacks on a phone.

```ts
// block-css.ts
export const NOTICE_CSS = `
.acme-notice { display: flex; gap: calc(16px * var(--density)); align-items: flex-start; padding: calc(20px * var(--density)); background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow-card); }
.acme-notice-title { margin: 0 0 calc(6px * var(--density)); font-family: var(--font-heading); font-weight: var(--heading-weight); font-size: 1.2rem; line-height: 1.3; }
.acme-notice-meta { margin: 0; color: var(--muted); font-size: 0.9rem; }
.acme-notice-badge { flex: none; padding: calc(3px * var(--density)) calc(10px * var(--density)); border-radius: var(--radius-badge); background: var(--ok-bg); color: var(--ok-ink); font-size: 0.8rem; font-weight: 700; }
.acme-notice a { color: var(--primary-text); }
.acme-notice a:focus-visible { outline: 2px solid var(--primary-text); outline-offset: 2px; }
@media (max-width: 480px) {
  .acme-notice { flex-direction: column; padding: calc(16px * var(--density)); }
}
`
```

```tsx
// block.tsx
import { definePluginBlock } from '@pet-adopt/plugin-sdk'
import { NOTICE_CSS } from './block-css'

export const noticeBlock = definePluginBlock({
  name: 'AcmeNotice',
  label: 'Notice',
  plugin: 'acme-notices',
  fields: { heading: { type: 'text', label: 'Heading' }, note: { type: 'text', label: 'Note' } },
  defaultProps: { heading: 'Open day on Saturday', note: 'From 10 am to 4 pm.' },
  css: NOTICE_CSS,
  render: ({ heading, note, headingLevel }) => {
    const Heading = headingLevel === 1 ? 'h1' : 'h2'
    return (
      <section className="section">
        <div className="container">
          <div className="acme-notice">
            <span className="acme-notice-badge">New</span>
            <div>
              <Heading className="acme-notice-title">{heading}</Heading>
              <p className="acme-notice-meta">
                {note} <a href="/pets">Meet the pets</a>
              </p>
            </div>
          </div>
        </div>
      </section>
    )
  },
})
```

There is no dark-mode rule anywhere: `--surface`, `--ink`, `--muted`, `--ok-bg`, `--ok-ink` and `--primary-text` all take their dark values on a dark page.

## Checking your block

Before you publish a plugin, look at the block:

- On each of the five presets (Theme screen), in light and in dark (the site's switch, or the builder's **Dark preview**).
- With **Spacing** set to Compact and to Spacious, **Text size** set to Large and **Corners** set to Square (a theme of your own on the Theme screen: **New theme**, or **Customise** on a preset).
- At the Phone width in the page builder.
- With a keyboard: every link and control shows a focus ring.

For the site's own code: when you rename or remove one of the variables above, update `THEME_VARIABLES` and this page, and treat it as a breaking change for plugins. `check:backend` fails until the theme output, the stylesheet's fallback, the list and this page agree.
