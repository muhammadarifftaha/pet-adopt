// The Instagram feed block's CSS, as text: the public site and the page builder's canvas load no
// Tailwind, so the block brings its own rules. Every colour, radius, font and spacing value is one
// of the site's theme variables (apps/web/src/lib/theme.ts), so the block follows the theme and
// light or dark mode. The section, container, heading and button looks are the site's own classes
// (`section`, `container`, `block-heading`, `btn`); only what is new here is styled.
//
// Widths use plain `@media` rules like the site's styles.css: the page builder's canvas is an
// iframe, so they apply at its Phone, Tablet and Laptop widths too.
//
// Spacing follows the site's pattern: a length times the theme's spacing (`--density`). The size of
// the profile photo is the block's own variable (`--ig-feed-photo`), set once per width. Border and
// outline widths are plain values, as in the site's styles.css.
//
// A picture that cannot be loaded shows its text alternative (Instagram's picture addresses expire
// when the feed cannot be read for a while), so both kinds of picture give that text a small size
// and the theme's neutral pair, which keeps 4.5:1 in light and dark.

export const BLOCK_CSS = `
.ig-feed { --ig-feed-photo: 112px; --ig-feed-inset: calc(8px * var(--density, 1)); }
.ig-feed-profile { display: flex; align-items: flex-start; gap: calc(28px * var(--density, 1)); margin-bottom: calc(28px * var(--density, 1)); }
.ig-feed-profile[data-photo-side='right'] { flex-direction: row-reverse; }
.ig-feed-photo { flex: none; width: var(--ig-feed-photo); height: var(--ig-feed-photo); border-radius: 50%; overflow: hidden; background: var(--placeholder); border: 1px solid var(--line); display: grid; place-items: center; color: var(--muted); font-family: var(--font-heading); font-weight: var(--heading-weight); font-size: 2.4rem; line-height: 1; }
.ig-feed-photo img { display: block; width: 100%; height: 100%; object-fit: cover; overflow: hidden; background: var(--neutral-bg); color: var(--neutral-ink); font-family: var(--font-body, inherit); font-weight: 400; font-size: 0.7rem; line-height: 1.2; text-align: center; overflow-wrap: anywhere; }
.ig-feed-summary { flex: 1; min-width: 0; display: grid; gap: calc(8px * var(--density, 1)); overflow-wrap: anywhere; }
.ig-feed-handle { margin: 0; font-family: var(--font-heading); font-weight: var(--heading-weight); font-size: 1.3rem; line-height: 1.3; }
.ig-feed-handle a { color: var(--ink); text-decoration: none; }
.ig-feed-handle a:hover { color: var(--primary-text); text-decoration: underline; }
.ig-feed-counts { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: calc(4px * var(--density, 1)) calc(24px * var(--density, 1)); color: var(--ink); }
.ig-feed-counts strong { font-weight: 700; }
.ig-feed-name { margin: 0; font-weight: 700; color: var(--ink); }
.ig-feed-bio { margin: 0; max-width: 60ch; color: var(--ink); white-space: pre-line; }

.ig-feed-grid { list-style: none; margin: 0; padding: 0; display: grid; gap: calc(10px * var(--density, 1)); grid-template-columns: repeat(3, minmax(0, 1fr)); }
.ig-feed-grid[data-columns='2'] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.ig-feed-grid[data-columns='4'] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.ig-feed-grid[data-columns='5'] { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.ig-feed-tile { position: relative; display: block; aspect-ratio: 1; overflow: hidden; border-radius: var(--radius-sm); background: var(--placeholder); box-shadow: var(--shadow-card); color: var(--muted); }
.ig-feed-tile img { display: block; width: 100%; height: 100%; object-fit: cover; overflow: hidden; background: var(--neutral-bg); color: var(--neutral-ink); font-size: 0.8rem; line-height: 1.3; overflow-wrap: anywhere; transition: transform 0.2s, opacity 0.2s; }
.ig-feed-tile:hover img { transform: scale(1.04); opacity: 0.9; }
.ig-feed-tile:focus-visible { outline: 3px solid var(--primary-text); outline-offset: 2px; }
.ig-feed-marks { position: absolute; top: var(--ig-feed-inset); left: var(--ig-feed-inset); right: var(--ig-feed-inset); display: flex; justify-content: space-between; align-items: flex-start; gap: calc(6px * var(--density, 1)); pointer-events: none; }
.ig-feed-mark { display: inline-flex; align-items: center; gap: calc(4px * var(--density, 1)); padding: calc(3px * var(--density, 1)) calc(8px * var(--density, 1)); border-radius: var(--radius-badge); background: var(--neutral-bg); color: var(--neutral-ink); font-size: 0.75rem; font-weight: 700; line-height: 1.3; }
.ig-feed-mark svg { display: block; width: 1.15em; height: 1.15em; fill: currentColor; }
.ig-feed-mark-kind { margin-left: auto; padding: calc(5px * var(--density, 1)); }
.ig-feed-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

.ig-feed-more { margin: calc(28px * var(--density, 1)) 0 0; text-align: center; }
.ig-feed-profile + .ig-feed-more, .block-heading + .ig-feed-more { margin-top: 0; text-align: left; }
.ig-feed-note { margin: 0; padding: calc(24px * var(--density, 1)); border: 2px dashed var(--line-strong); border-radius: var(--radius); background: var(--surface-alt); color: var(--muted); text-align: center; }
.ig-feed-note strong { display: block; color: var(--ink); }

@media (max-width: 640px) {
  .ig-feed { --ig-feed-photo: 76px; --ig-feed-inset: calc(6px * var(--density, 1)); }
  .ig-feed-profile { gap: calc(16px * var(--density, 1)); margin-bottom: calc(20px * var(--density, 1)); }
  .ig-feed-photo { font-size: 1.7rem; }
  .ig-feed-handle { font-size: 1.15rem; }
  .ig-feed-counts { column-gap: calc(16px * var(--density, 1)); }
  .ig-feed-grid { gap: calc(6px * var(--density, 1)); }
  .ig-feed-grid[data-columns='4'], .ig-feed-grid[data-columns='5'] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 400px) {
  .ig-feed { --ig-feed-photo: 64px; }
  .ig-feed-photo { font-size: 1.4rem; }
  .ig-feed-grid, .ig-feed-grid[data-columns] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  .ig-feed-tile img { transition: none; }
  .ig-feed-tile:hover img { transform: none; }
}
`
