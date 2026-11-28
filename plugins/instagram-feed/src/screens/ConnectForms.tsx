'use client'

import { Button } from '@pet-adopt/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pet-adopt/ui/components/card'
import { Field, FieldDescription, FieldLabel } from '@pet-adopt/ui/components/field'
import { Input } from '@pet-adopt/ui/components/input'
import React, { useState } from 'react'

import { connectWithTokenAction, saveAppKeysAction, startAuthorizationAction } from '../actions'
import type { ConnectionView } from '../types'
import type { Run } from './InstagramScreen'

type Props = {
  connection: ConnectionView
  canConnect: boolean
  pending: boolean
  run: Run
  reload: () => Promise<void>
  onConnection: (view: ConnectionView) => void
  /** Field errors of the last failed action (also listed in the screen's summary). */
  errors: Record<string, string>
}

const describedBy = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(' ') || undefined

// Connecting, two ways, each in a card of its own:
//   1. the owner's own Meta app: its keys are saved here, then Instagram's sign-in does the rest;
//   2. an access token made in the Meta app, pasted here.
// Secrets only travel to the server: a saved app secret or token is never sent back (the view says
// whether one is saved), and a blank secret box keeps the saved one. Audit sees it all read-only.
export function ConnectForms({ connection, canConnect, pending, run, reload, onConnection, errors }: Props) {
  const [appId, setAppId] = useState(connection.appId)
  const [appSecret, setAppSecret] = useState('')
  const [clearSecret, setClearSecret] = useState(false)
  const [token, setToken] = useState('')
  const [copied, setCopied] = useState('')

  // What is typed differs from what is saved: save before connecting.
  const unsaved = appId.trim() !== connection.appId || Boolean(appSecret.trim()) || clearSecret
  const keysReady = Boolean(connection.appId) && connection.appSecretSet && !unsaved
  const https = connection.redirectUri.startsWith('https://')
  const secretError = errors.appSecret ?? errors.clearSecret

  const saveKeys = () =>
    run(
      () => saveAppKeysAction({ appId: appId.trim(), appSecret: appSecret.trim() || undefined, clearSecret }),
      (view) => {
        onConnection(view)
        setAppId(view.appId)
        setAppSecret('')
        setClearSecret(false)
        return view.appId && view.appSecretSet ? 'Keys saved. Now press “Connect with Instagram”.' : 'Saved.'
      },
    )

  const authorize = () => {
    if (!keysReady) return
    run(startAuthorizationAction, ({ url }) => {
      // Only ever to an https address (Instagram's sign-in).
      if (!url.startsWith('https://')) return 'Instagram’s sign-in could not be opened. Check the app keys and try again.'
      window.location.assign(url)
      return 'Opening Instagram…'
    })
  }

  const connectWithToken = () =>
    run(
      () => connectWithTokenAction({ token: token.trim() }),
      async (view) => {
        onConnection(view)
        setToken('')
        await reload()
        return view.account ? `@${view.account.username} is connected.` : 'The account is connected.'
      },
    )

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(connection.redirectUri)
      setCopied('Copied.')
    } catch {
      setCopied('Could not copy. Select the address and copy it by hand.')
    }
  }

  return (
    <section id="ig-connect" aria-labelledby="ig-connect-title" className="flex flex-col gap-4">
      <div>
        <h2 id="ig-connect-title" className="text-base font-medium">
          {connection.connected ? 'Connect a different account, or connect again' : 'Connect an account'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {canConnect ? 'There are two ways; use one of them.' : 'Your role can view the connection but not change it.'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>1. Your own Meta app (recommended)</CardTitle>
          <CardDescription>
            Make an app at <span className="break-all font-mono text-xs">developers.facebook.com</span>, add the Instagram product with “Instagram login”, and copy
            its Instagram app ID and app secret here. Then sign in with Instagram and agree to share the profile and posts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset disabled={!canConnect} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
            <Field data-invalid={errors.appId ? true : undefined}>
              <FieldLabel htmlFor="ig-app-id">App ID</FieldLabel>
              <Input
                id="ig-app-id"
                value={appId}
                onChange={(event) => setAppId(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={errors.appId ? true : undefined}
                aria-describedby={describedBy('ig-app-id-note', errors.appId && 'ig-app-id-error')}
              />
              <FieldDescription id="ig-app-id-note">The Instagram app ID of your Meta app (a number). Not a secret.</FieldDescription>
              {errors.appId ? (
                <p id="ig-app-id-error" className="text-sm text-destructive">
                  {errors.appId}
                </p>
              ) : null}
            </Field>

            <Field data-invalid={secretError ? true : undefined}>
              <FieldLabel htmlFor="ig-app-secret">App secret</FieldLabel>
              <Input
                id="ig-app-secret"
                type="password"
                value={appSecret}
                onChange={(event) => setAppSecret(event.target.value)}
                autoComplete="new-password"
                placeholder={connection.appSecretSet ? 'Saved (leave blank to keep it)' : ''}
                aria-invalid={secretError ? true : undefined}
                aria-describedby={describedBy('ig-app-secret-note', secretError && 'ig-app-secret-error')}
              />
              <FieldDescription id="ig-app-secret-note">
                {connection.appSecretSet ? 'An app secret is saved. It is stored encrypted and never shown again.' : 'Stored encrypted and never shown again.'}
              </FieldDescription>
              {secretError ? (
                <p id="ig-app-secret-error" className="text-sm text-destructive">
                  {secretError}
                </p>
              ) : null}
              {connection.appSecretSet ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={clearSecret} onChange={(event) => setClearSecret(event.target.checked)} />
                  Remove the saved app secret
                </label>
              ) : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="ig-redirect">Redirect address for the Meta app</FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="ig-redirect"
                  value={connection.redirectUri}
                  readOnly
                  spellCheck={false}
                  className="min-w-0 flex-1 font-mono text-xs"
                  onFocus={(event) => event.target.select()}
                  aria-describedby="ig-redirect-note"
                />
                <Button type="button" variant="outline" onClick={copy}>
                  Copy
                </Button>
              </div>
              <FieldDescription id="ig-redirect-note">
                Paste it into the Meta app as the “OAuth redirect URI” of Instagram login, exactly as it is. Instagram only sends people back to an https
                address, so the site must be on https.
                {https ? '' : ' This site’s address is not https: use the access token below instead, or put the site on https first.'}
              </FieldDescription>
              <span role="status" aria-live="polite" className="text-sm">
                {copied}
              </span>
            </Field>

            {canConnect ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant={keysReady ? 'outline' : 'default'} onClick={saveKeys} aria-disabled={pending || undefined}>
                  {pending ? 'Working…' : 'Save keys'}
                </Button>
                <Button type="button" variant={keysReady ? 'default' : 'outline'} onClick={authorize} aria-disabled={pending || !keysReady || undefined} aria-describedby="ig-authorize-note">
                  {connection.connected ? 'Connect with Instagram again' : 'Connect with Instagram'}
                </Button>
                <span id="ig-authorize-note" className="text-sm text-muted-foreground">
                  {keysReady
                    ? 'You go to Instagram, agree, and come back here.'
                    : unsaved
                      ? 'Save the keys first.'
                      : 'Save an app ID and an app secret first.'}
                </span>
              </div>
            ) : null}
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>2. Paste an access token</CardTitle>
          <CardDescription>
            For when Instagram’s sign-in cannot come back to this site. In your Meta app’s Instagram settings, add the Instagram account to the app and generate
            an access token for it, then paste the token here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset disabled={!canConnect} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
            <Field data-invalid={errors.token ? true : undefined}>
              <FieldLabel htmlFor="ig-token">Access token</FieldLabel>
              <Input
                id="ig-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={errors.token ? true : undefined}
                aria-describedby={describedBy('ig-token-note', errors.token && 'ig-token-error')}
              />
              <FieldDescription id="ig-token-note">
                {connection.method === 'token' ? 'A token is saved. Pasting another replaces it. ' : ''}
                Checked with Instagram when you connect, stored encrypted and never shown again.
              </FieldDescription>
              {errors.token ? (
                <p id="ig-token-error" className="text-sm text-destructive">
                  {errors.token}
                </p>
              ) : null}
            </Field>
            {canConnect ? (
              <div>
                <Button type="button" variant="outline" onClick={connectWithToken} aria-disabled={pending || undefined}>
                  {pending ? 'Working…' : 'Connect'}
                </Button>
              </div>
            ) : null}
          </fieldset>
        </CardContent>
      </Card>
    </section>
  )
}
