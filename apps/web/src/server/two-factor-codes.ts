// Backup codes for two-factor sign-in: the format, the generator Better Auth uses
// (src/server/auth.ts) and the clean-up of what people type. No database here, so auth.ts can
// import it without a cycle.
import { randomInt } from 'node:crypto'

/** Lower case and digits without look-alikes (no 0/o, 1/l/i), so a code copied by hand still works. */
export const BACKUP_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const BACKUP_CODE_COUNT = 10
const HALF = 5

/** Ten codes like `k7m2p-x9qrt` (about 50 bits each), from the system's secure random source. */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const part = () => Array.from({ length: HALF }, () => BACKUP_CODE_ALPHABET[randomInt(BACKUP_CODE_ALPHABET.length)]).join('')
  return Array.from({ length: count }, () => `${part()}-${part()}`)
}

/**
 * A typed backup code in the stored form, or null when it cannot be one: spaces and dashes are
 * ignored and case does not matter, so `K7M2 PX9QRT` becomes `k7m2p-x9qrt`.
 */
export function normalizeBackupCode(input: string): string | null {
  const compact = input.toLowerCase().replace(/[\s-]/g, '')
  if (compact.length !== HALF * 2) return null
  for (const char of compact) if (!BACKUP_CODE_ALPHABET.includes(char)) return null
  return `${compact.slice(0, HALF)}-${compact.slice(HALF)}`
}

/** A typed authenticator code (6 digits, spaces allowed: `123 456`), or null. */
export function normalizeTotpCode(input: string): string | null {
  const compact = input.replace(/\s/g, '')
  return /^\d{6}$/.test(compact) ? compact : null
}
