/** Only allow links an owner could reasonably mean. Blocks javascript: and data: URLs. */
export function safeHref(href?: string | null): string {
  const value = (href ?? '').trim()
  if (!value) return '#'
  // A single leading slash is a path on this site. "//host" and "/\host" point elsewhere. Browsers
  // also delete tabs and line breaks inside a URL before reading it, so "/<TAB>/host" would become
  // "//host": a path may not contain control characters or backslashes at all.
  if (/^\/(?![/\\])[^\u0000-\u001f\u007f\\]*$/.test(value) || value.startsWith('#')) return value
  if (/^(https?:\/\/|mailto:|tel:)/i.test(value)) return value
  return '#'
}

/**
 * Where to go after signing in: a path on this site only, so `?redirect=` cannot send someone to
 * another site (an open redirect). Anything else, including another sign-in page, gives `fallback`.
 */
export function safeRedirectPath(value: unknown, fallback = '/admin'): string {
  if (typeof value !== 'string') return fallback
  const path = value.trim()
  if (!/^\/(?![/\\])[^\u0000-\u001f\u007f\\]*$/.test(path)) return fallback
  if (/^\/admin\/login(?:[/?#]|$)/.test(path)) return fallback
  return path
}

/** A validator for an absolute http(s) link, such as a social profile. */
export const validateWebUrl = (value?: string | null) =>
  !value || /^https?:\/\/\S+$/i.test(value.trim()) ? true : 'Enter a full link starting with https://'

/** A validator for a link that must be https, such as a video (an http link is mixed content on an https site). */
export const validateHttpsUrl = (value?: string | null) =>
  !value || /^https:\/\/\S+$/i.test(value.trim()) ? true : 'Enter a full link starting with https://'

/** A validator for a path on this site, an anchor, or an http(s)/mailto/tel link. */
export const validateLink = (value?: string | null) =>
  !value || safeHref(value) !== '#' || value.trim() === '#'
    ? true
    : 'Use a path like /pets, or a full link starting with https://'

export const isExternal = (href: string) => /^(https?:)?\/\//i.test(href)

// Only Google Maps embed URLs may be placed in an iframe.
export function safeMapEmbed(url?: string | null): string | null {
  const value = (url ?? '').trim()
  return /^https:\/\/www\.google\.com\/maps\/embed\?/.test(value) ? value : null
}
