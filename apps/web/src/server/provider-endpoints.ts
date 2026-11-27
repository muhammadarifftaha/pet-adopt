import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { isPrivateAddress } from './avatars'
import { isLoopbackHost } from './email'

// Where a sign-in provider's addresses may point. The server itself calls them (the discovery
// document, the token and user-info endpoints, the signing keys), so an address inside a private
// network would let whoever sets up providers make the server reach machines only it can see.
// They must therefore be on the public internet, unless AUTH_PROVIDER_PRIVATE_ADDRESSES=1 says the
// provider really is on a private network (a company's own identity server, for example).
//
// Checked when a provider is saved (a field error) and again each time the sign-in setup is built
// (the provider is skipped). These checks give people a clear message early; they are not the
// guarantee, because whoever runs a provider can answer a check one way and the real request
// another. The guarantee is provider-guard.ts, which refuses the connection itself.

/** The switch that allows providers on private addresses. */
export const PRIVATE_PROVIDERS_VARIABLE = 'AUTH_PROVIDER_PRIVATE_ADDRESSES'

export function privateProvidersAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true'].includes((env[PRIVATE_PROVIDERS_VARIABLE] ?? '').trim().toLowerCase())
}

const PRIVATE = `This address is inside a private network. Use a public address, or set ${PRIVATE_PROVIDERS_VARIABLE}=1 on the server if the provider really is on your own network.`

/**
 * Why the server must not call `value`, or null. A name that cannot be looked up is let through:
 * nothing can be reached at it, and it is checked again when it is used.
 */
export async function endpointProblem(value: string): Promise<string | null> {
  if (privateProvidersAllowed()) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  // A provider on this machine, for development (the same rule as http:// addresses).
  if (isLoopbackHost(hostname) && process.env.NODE_ENV !== 'production') return null
  const addresses = isIP(hostname) ? [hostname] : (await lookup(hostname, { all: true }).catch(() => [])).map((entry) => entry.address)
  return addresses.some(isPrivateAddress) ? PRIVATE : null
}

const DISCOVERY_MS = 5000
const DISCOVERY_LIMIT = 1_000_000
/** The addresses in a discovery document that the server calls (the authorization one is opened by the browser). */
const CALLED = ['token_endpoint', 'userinfo_endpoint', 'jwks_uri'] as const

/**
 * Why a discovery document must not be used, or null: it answers with a redirect (which would be
 * followed to an address nobody checked), or it names an address inside a private network.
 *
 * A document that cannot be read: with `strict` (when the sign-in setup is built) that is a
 * problem too, so a provider is never used unchecked; without it (when saving, where the provider
 * may simply be offline) it is not.
 */
export async function discoveryProblem(discoveryUrl: string, { strict = false } = {}): Promise<string | null> {
  const unread = strict ? 'Its discovery document could not be read, so its addresses could not be checked.' : null
  if (privateProvidersAllowed()) return null
  const own = await endpointProblem(discoveryUrl)
  if (own) return own
  let document: Record<string, unknown>
  try {
    const response = await fetch(discoveryUrl, { redirect: 'manual', signal: AbortSignal.timeout(DISCOVERY_MS), headers: { accept: 'application/json' } })
    if (response.status >= 300 && response.status < 400) return 'This address redirects somewhere else. Enter the final address of the discovery document.'
    if (!response.ok) return unread
    const text = await response.text()
    if (text.length > DISCOVERY_LIMIT) return unread
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return unread
    document = parsed as Record<string, unknown>
  } catch {
    return unread
  }
  for (const key of CALLED) {
    const named = document[key]
    if (typeof named !== 'string' || !named) continue
    let address: string
    try {
      address = new URL(named, discoveryUrl).href
    } catch {
      continue
    }
    if (await endpointProblem(address)) {
      return `This provider's discovery document names an address inside a private network (${key}). Set ${PRIVATE_PROVIDERS_VARIABLE}=1 on the server if the provider really is on your own network.`
    }
  }
  return null
}
