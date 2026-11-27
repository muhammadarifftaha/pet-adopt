import { AsyncLocalStorage } from 'node:async_hooks'
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { isIP } from 'node:net'

import { Agent, buildConnector, fetch as undiciFetch } from 'undici'

import { isPrivateAddress } from './avatars'
import { isLoopbackHost } from './email'
import { PRIVATE_PROVIDERS_VARIABLE, privateProvidersAllowed } from './provider-endpoints'

// Sign-in providers are addresses an admin types in, and the server calls them: the discovery
// document, the token and user-info endpoints, the signing keys. Checking an address before the
// request is not enough, because whoever runs the provider can answer the check one way and the
// request another (a host name that changes its answer, a redirect, a second discovery document).
//
// So the rule is applied where it cannot be dodged: at the connection. Every request Better Auth
// makes runs inside `guarded()`, and inside it `fetch` goes through a connector that looks at the
// address it is about to connect to, after the name was resolved, for every hop of a redirect, and
// refuses one that is not on the public internet. The address checked is the address used.
//
// AUTH_PROVIDER_PRIVATE_ADDRESSES=1 switches it off (a provider on the owner's own network), and a
// provider on this machine is allowed outside production, as for http:// addresses.

type Slot = { scope: AsyncLocalStorage<true>; installed?: boolean }
// One per process, whatever bundle loads this file: the scope must be the one `fetch` reads.
const slot = ((globalThis as { __petAdoptProviderGuard?: Slot }).__petAdoptProviderGuard ??= { scope: new AsyncLocalStorage<true>() })

const refusal = (host: string) =>
  new Error(`a sign-in provider request to ${host} was refused: the address is inside a private network (set ${PRIVATE_PROVIDERS_VARIABLE}=1 to allow it)`)


type LookupCallback = (error: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void

/** dns.lookup, refusing a name when any of its addresses is not public. */
function checkedLookup(hostname: string, options: { all?: boolean } & Record<string, unknown>, callback: LookupCallback): void {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error)
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) return callback(refusal(hostname))
    if (options.all) callback(null, addresses)
    else callback(null, addresses[0].address, addresses[0].family)
  })
}

// The lookup must be given when the connector is BUILT: undici passes the build options to the
// socket and ignores a `lookup` handed over per connection.
const plain = buildConnector({ timeout: 10_000 })
const checked = buildConnector({ timeout: 10_000, lookup: checkedLookup } as Parameters<typeof buildConnector>[0])

const agent = new Agent({
  connect(options, callback) {
    const hostname = options.hostname.replace(/^\[|\]$/g, '')
    const open = privateProvidersAllowed() || (isLoopbackHost(hostname) && process.env.NODE_ENV !== 'production')
    if (open) return plain(options, callback)
    // An address written out needs no lookup, so it is checked here.
    if (isIP(hostname)) return isPrivateAddress(hostname) ? callback(refusal(hostname), null) : plain(options, callback)
    return checked(options, callback)
  },
})

function install(): void {
  if (slot.installed) return
  slot.installed = true
  const real = globalThis.fetch
  const viaAgent = undiciFetch as unknown as (input: unknown, init?: Record<string, unknown>) => Promise<Response>
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!slot.scope.getStore()) return real(input, init)
    if (input instanceof Request) {
      // Rebuilt as an address and options: the connector's fetch does not know this Request class.
      const body = input.body ? await input.arrayBuffer() : undefined
      return viaAgent(input.url, { method: input.method, headers: Object.fromEntries(input.headers), body, redirect: input.redirect, signal: input.signal, ...init, dispatcher: agent })
    }
    return viaAgent(String(input), { ...init, dispatcher: agent })
  }) as typeof fetch
}

/** Runs `fn` with every `fetch` it makes (however deep) held to public addresses. */
export function guarded<T>(fn: () => T): T {
  install()
  return slot.scope.run(true, fn)
}

/** `target` with each of its functions run inside `guarded` (their own properties kept). */
export function guardedFunctions<T extends object>(target: T): T {
  return new Proxy(target, {
    get(object, key, receiver) {
      const value = Reflect.get(object, key, receiver) as unknown
      if (typeof value !== 'function') return value
      const call = value as (...args: unknown[]) => unknown
      return Object.assign((...args: unknown[]) => guarded(() => call.apply(object, args)), value)
    },
  })
}
