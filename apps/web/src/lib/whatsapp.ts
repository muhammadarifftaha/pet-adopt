// Country code used when an owner types a local number such as 012-345 6789.
// Defaults to Malaysia (60). Override with NEXT_PUBLIC_DEFAULT_COUNTRY_CODE.
const DEFAULT_COUNTRY_CODE = process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE || '60'

/** Strips formatting and returns digits in international format (no "+"), or '' if unusable. */
export function normalizePhone(raw?: string | null): string {
  if (!raw) return ''
  // "+44 (0)7700 900123": the "(0)" is a trunk prefix people write but never dial.
  let digits = raw.replace(/\(\s*0\s*\)/g, '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.startsWith('0')) digits = DEFAULT_COUNTRY_CODE + digits.slice(1)
  return digits.length >= 8 && digits.length <= 15 ? digits : ''
}

export function buildWhatsAppUrl(phone?: string | null, message?: string | null): string | null {
  const number = normalizePhone(phone)
  if (!number) return null
  const text = message ? `?text=${encodeURIComponent(message)}` : ''
  return `https://wa.me/${number}${text}`
}

/** Replaces {pet} in the owner's message template. */
export function fillMessage(template: string | null | undefined, petName?: string | null): string {
  const base = template?.trim() || "Hi! I'm interested in adopting {pet}."
  const name = petName || 'one of your pets'
  // A function replacement, so "$&" or "$1" in a pet name is not treated as a pattern.
  return base.replaceAll('{pet}', () => name)
}
