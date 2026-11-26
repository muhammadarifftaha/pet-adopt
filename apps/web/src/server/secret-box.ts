// Small secrets the app must read back (the SMTP password), encrypted at rest. AES-256-GCM with a
// key derived from BETTER_AUTH_SECRET by HKDF-SHA256, so the database alone (a backup, a leaked
// dump) does not give the password away. Stored as `v1.<iv>.<tag>.<ciphertext>` (base64url).
//
// Changing BETTER_AUTH_SECRET makes stored values unreadable: `open` then returns null and the
// screen asks for the password again. Nothing here is for passwords people sign in with (those are
// hashed by Better Auth).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

import { authSecret } from './auth'

const VERSION = 'v1'

function keyFor(purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', authSecret(), 'pet-adopt secret-box', `${VERSION}:${purpose}`, 32))
}

/** Encrypts `plain` for one `purpose` (a value sealed for one purpose cannot be opened as another). */
export function seal(plain: string, purpose: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFor(purpose), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}

/** The plain text, or null when the value is damaged or was sealed with another secret or purpose. */
export function open(sealed: string | null | undefined, purpose: string): string | null {
  if (!sealed) return null
  const [version, iv, tag, data] = sealed.split('.')
  if (version !== VERSION || !iv || !tag || data === undefined) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFor(purpose), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
