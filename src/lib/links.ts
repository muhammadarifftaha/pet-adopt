/** Only allow links an owner could reasonably mean. Blocks javascript: and data: URLs. */
export function safeHref(href?: string | null): string {
  const value = (href ?? '').trim()
  if (!value) return '#'
  // A single leading slash is a path on this site. "//host" and "/\host" point elsewhere.
  if (/^\/(?![/\\])/.test(value) || value.startsWith('#')) return value
  if (/^(https?:\/\/|mailto:|tel:)/i.test(value)) return value
  return '#'
}

/** Payload field validator: an absolute http(s) link, such as a social profile. */
export const validateWebUrl = (value?: string | null) =>
  !value || /^https?:\/\/\S+$/i.test(value.trim()) ? true : 'Enter a full link starting with https://'

/** Payload field validator: a path on this site, an anchor, or an http(s)/mailto/tel link. */
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
