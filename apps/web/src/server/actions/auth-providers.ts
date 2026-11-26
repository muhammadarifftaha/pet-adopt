'use server'

// Sign-in providers (rules in ../auth-providers.ts): the admin's list (Authentication > Sign-in
// providers), starting a provider sign-in (sign-in page, public), and connecting or disconnecting
// one for your own account (Account page). The provider's callback itself is Better Auth's
// /api/auth/callback/<id> route; its sign-ins and new connections are logged by the hooks in
// ../auth.ts.
import { headers } from 'next/headers'

import { safeRedirectPath } from '@/lib/links'

import { quoted, recordActivity } from '../activity'
import { forgetAuth, getAuth } from '../auth'
import {
  connectedProviders,
  deleteAuthProvider,
  disconnectProvider,
  listAuthProviders,
  listEnabledProviders,
  saveAuthProvider,
  type AuthProviderView,
  type PublicProvider,
} from '../auth-providers'
import { assertId, run, UserError, type ActionResult } from '../result'
import { requirePermission, requireUser } from '../session'
import { clientAddress, CLIENT_RULE, consumeAttempt } from '../throttle'

export type MyProvider = PublicProvider & { connected: boolean }

async function enabledProvider(slug: unknown): Promise<PublicProvider> {
  const provider = typeof slug === 'string' ? (await listEnabledProviders()).find((p) => p.slug === slug) : undefined
  if (!provider) throw new UserError('That sign-in provider is not available.')
  return provider
}

/** A Better Auth answer with a provider address to send the browser to. */
function providerUrl(result: unknown): string {
  const url = (result as { url?: unknown } | null)?.url
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new UserError('The sign-in provider did not answer. Try again, or ask an admin.')
  return url
}

// --- Admins ------------------------------------------------------------------------------------

export async function listAuthProvidersAction(): Promise<ActionResult<AuthProviderView[]>> {
  return run(async () => {
    await requirePermission('users:view')
    return listAuthProviders()
  })
}

/** Adds (`id` null) or changes a provider. Better Auth is rebuilt with it at once on this server. */
export async function saveAuthProviderAction(id: number | null, input: unknown): Promise<ActionResult<AuthProviderView>> {
  return run(async () => {
    const actor = await requirePermission('users:edit')
    const { provider, fields } = await saveAuthProvider(id === null ? null : assertId(id), input)
    forgetAuth()
    if (id === null || fields.length) {
      await recordActivity({
        actor,
        action: id === null ? 'settings.auth-provider.create' : 'settings.auth-provider.update',
        area: 'settings',
        summary: id === null ? `Added the sign-in provider ${quoted(provider.name)}` : `Changed the sign-in provider ${quoted(provider.name)}`,
        subject: { id: provider.id, label: provider.name },
        fields,
      })
    }
    return provider
  })
}

/** Deletes a provider; everyone connected to it is disconnected. */
export async function deleteAuthProviderAction(id: number): Promise<ActionResult> {
  return run(async () => {
    const actor = await requirePermission('users:edit')
    const target = assertId(id)
    const removed = await deleteAuthProvider(target)
    forgetAuth()
    await recordActivity({
      actor,
      action: 'settings.auth-provider.delete',
      area: 'settings',
      summary: `Deleted the sign-in provider ${quoted(removed.name)} (${removed.disconnected} ${removed.disconnected === 1 ? 'account' : 'accounts'} disconnected)`,
      subject: { id: target, label: removed.name },
    })
  })
}

// --- Signing in --------------------------------------------------------------------------------

/**
 * Starts a sign-in with a provider: `{ provider, redirectTo }`. Returns the provider's address to
 * send the browser to. Only an account that connected this provider gets in; errors come back to
 * the sign-in page as ?error=<code>. Limited per client (each start stores a little state).
 */
export async function startProviderSignInAction(input: { provider: string; redirectTo?: string }): Promise<ActionResult<{ url: string }>> {
  return run(async () => {
    const requestHeaders = await headers()
    const address = clientAddress(requestHeaders)
    if (address) await consumeAttempt(`oauth:ip:${address}`, CLIENT_RULE)
    const provider = await enabledProvider(input?.provider)
    const auth = await getAuth()
    const result = await auth.api.signInSocial({
      body: {
        provider: provider.slug,
        callbackURL: safeRedirectPath(input?.redirectTo),
        errorCallbackURL: '/admin/login',
        disableRedirect: true,
      },
      headers: requestHeaders,
    })
    return { url: providerUrl(result) }
  })
}

// --- Your own account --------------------------------------------------------------------------

/** The enabled providers and whether you connected each. */
export async function getMyProvidersAction(): Promise<ActionResult<MyProvider[]>> {
  return run(async () => {
    const user = await requireUser()
    const [providers, connected] = await Promise.all([listEnabledProviders(), connectedProviders(user.id)])
    return providers.map((provider) => ({ ...provider, connected: connected.has(provider.slug) }))
  })
}

/**
 * Connects a provider to your account: returns the provider's address. You sign in there, and come
 * back to the Account page (?error=<code> when it did not work). Afterwards it signs you in here.
 */
export async function connectProviderAction(slug: string): Promise<ActionResult<{ url: string }>> {
  return run(async () => {
    await requireUser()
    const provider = await enabledProvider(slug)
    const auth = await getAuth()
    const result = await auth.api.linkSocialAccount({
      body: {
        provider: provider.slug,
        callbackURL: `/admin/account?connected=${provider.slug}`,
        errorCallbackURL: '/admin/account',
        disableRedirect: true,
      },
      headers: await headers(),
    })
    return { url: providerUrl(result) }
  })
}

/** Disconnects a provider from your account. Your password keeps working. */
export async function disconnectProviderAction(slug: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser()
    if (typeof slug !== 'string' || !(await connectedProviders(user.id)).has(slug)) throw new UserError('That provider is not connected.')
    const name = (await listAuthProviders()).find((p) => p.slug === slug)?.name ?? slug
    // Every account keeps its password (accounts are made with one), so this never locks anyone out.
    await disconnectProvider(user.id, slug)
    await recordActivity({ actor: user, action: 'account.provider-disconnect', area: 'account', summary: `Disconnected ${name} from signing in` })
  })
}
