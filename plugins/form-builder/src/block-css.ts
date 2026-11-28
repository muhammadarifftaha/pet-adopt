// The Form block's CSS, as text: the public site and the page builder's canvas load no Tailwind, so
// the block brings its own rules (they were in the site's styles.css while the block was built in).
// Every colour and radius, and most spacing, is one of the site's theme variables
// (apps/web/src/lib/theme.ts), so the form follows the theme and light or dark mode. The section,
// container, heading and button looks are the site's own classes (`section`, `container`,
// `block-heading`, `btn`); only the form's own parts are styled here, all under `.fb-form`.
// Spacing follows the site's pattern: a length times the theme's spacing (`--density`). Border
// widths are plain values, as in the site's styles.css.

export const FORM_BLOCK_CSS = `
.fb-form-section { max-width: 42rem; }
.fb-form-intro { color: var(--muted); }
.fb-form { display: grid; gap: calc(18px * var(--density)); margin-top: calc(20px * var(--density)); }
.fb-form-field { display: grid; gap: 6px; margin: 0; padding: 0; border: 0; min-width: 0; }
.fb-form-label { font-weight: 600; color: var(--ink); padding: 0; }
.fb-form-required { font-weight: 400; color: var(--muted); }
.fb-form-hint { margin: 0; font-size: 0.9rem; color: var(--muted); }
.fb-form-field input:not([type="checkbox"]):not([type="radio"]), .fb-form-field select, .fb-form-field textarea {
  width: 100%; padding: 10px 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm);
  font: inherit; color: var(--ink); background: var(--surface);
}
.fb-form-field textarea { resize: vertical; min-height: 7rem; }
.fb-form-field.fb-form-has-error input:not([type="checkbox"]):not([type="radio"]), .fb-form-field.fb-form-has-error select, .fb-form-field.fb-form-has-error textarea { border-color: var(--warn-ink); }
.fb-form-options { display: grid; gap: 8px; }
.fb-form-option { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; color: var(--ink); }
.fb-form-option input { margin-top: 0.25em; width: 1.1em; height: 1.1em; accent-color: var(--primary); flex: none; }
.fb-form-error { margin: 0; font-size: 0.9rem; font-weight: 600; color: var(--warn-ink); }
.fb-form-summary { padding: 14px 16px; border-radius: var(--radius-sm); background: var(--warn-bg); color: var(--warn-ink); }
.fb-form-summary p { margin: 0 0 6px; font-weight: 600; }
/* Bullets: the live site loads Tailwind, whose reset removes them; the page builder does not. */
.fb-form-summary ul { margin: 0; padding-left: 1.2em; list-style: disc; }
.fb-form-summary a { color: inherit; text-decoration: underline; }
.fb-form-privacy { margin: 12px 0 0; font-size: 0.875rem; color: var(--muted); }
.fb-form-privacy a { color: inherit; }
.fb-form-success { padding: 16px 18px; border-radius: var(--radius-sm); background: var(--ok-bg); color: var(--ok-ink); font-weight: 600; }
.fb-form-closed, .fb-form-note { padding: 12px 14px; border-radius: var(--radius-sm); background: var(--surface-alt); color: var(--muted); }
.fb-form-actions .btn[aria-disabled="true"] { opacity: 0.6; cursor: not-allowed; }
/* The honeypot: off screen, not display:none (some bots skip hidden inputs). aria-hidden in the markup. */
.fb-form-hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
/* The spam check (captcha widget) above the button. */
.fb-form-captcha { margin: 8px 0 4px; min-height: 65px; }
.fb-form-captcha-error { margin: 8px 0; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--warn-bg); color: var(--warn-ink); }
`
