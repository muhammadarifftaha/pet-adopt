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

/**
 * A YouTube or Vimeo link turned into the player address to embed, or null for anything else. The
 * embed URL is built here from a checked video id, never taken from what was typed, so a block can
 * only ever frame these two players (the CSP's frame-src lists exactly them). YouTube uses its
 * no-cookie domain.
 */
export function safeVideoEmbed(url?: string | null): string | null {
  let parsed: URL
  try {
    parsed = new URL((url ?? '').trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  const host = parsed.hostname.replace(/^(www\.|m\.)/, '')
  const youTubeId = (id: string | null | undefined) =>
    id && /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null
  if (host === 'youtu.be') return youTubeId(parsed.pathname.split('/')[1])
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (parsed.pathname === '/watch') return youTubeId(parsed.searchParams.get('v'))
    const [, kind, id] = parsed.pathname.split('/')
    return kind === 'embed' || kind === 'shorts' || kind === 'live' ? youTubeId(id) : null
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = parsed.pathname.split('/').filter(Boolean).find((part) => /^\d{1,12}$/.test(part))
    return id ? `https://player.vimeo.com/video/${id}` : null
  }
  return null
}

// Only Google Maps embed URLs may be placed in an iframe.
export function safeMapEmbed(url?: string | null): string | null {
  const value = (url ?? '').trim()
  return /^https:\/\/www\.google\.com\/maps\/embed\?/.test(value) ? value : null
}
