'use client'

import { formatWhen } from '@pet-adopt/plugin-sdk'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@pet-adopt/ui/components/alert-dialog'
import { Badge } from '@pet-adopt/ui/components/badge'
import { Button } from '@pet-adopt/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pet-adopt/ui/components/card'
import React, { useEffect, useRef, useState } from 'react'

import { disconnectAction, refreshFeedAction } from '../actions'
import type { ConnectionView, InstagramFeedData } from '../types'
import { ProfilePhoto } from './FeedSummary'
import type { Run } from './InstagramScreen'

const ACCOUNT_TYPES: Record<string, string> = { BUSINESS: 'Business account', MEDIA_CREATOR: 'Creator account' }
const METHODS = { oauth: 'Through Instagram’s sign-in', token: 'With a pasted access token' }

type Props = {
  connection: ConnectionView | null
  feed: InstagramFeedData | null
  seesConnection: boolean
  canConnect: boolean
  canPin: boolean
  pending: boolean
  run: Run
  reload: () => Promise<void>
  onConnection: (view: ConnectionView) => void
  timeZone: string | null
  now: string
}

// The top card: which account is connected and how the feed is doing. Roles that cannot see the
// connection (editors) get the account from the feed itself, and may still refresh it.
export function ConnectionStatus({ connection, feed, seesConnection, canConnect, canPin, pending, run, reload, onConnection, timeZone, now }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const connected = connection ? connection.connected : Boolean(feed)
  const account = connection?.account ?? (feed ? { username: feed.profile.username, name: feed.profile.name, accountType: '', pictureUrl: feed.profile.pictureUrl } : null)
  const expired = Boolean(connection?.tokenExpiresAt) && new Date(connection!.tokenExpiresAt!).getTime() <= new Date(now).getTime()
  const lastRead = connection ? connection.lastFetchedAt : (feed?.fetchedAt ?? null)
  // After a disconnect the button that was pressed is gone (and the dialog with it), which would
  // leave the keyboard focus on the page itself. It goes to this card's title, which now says
  // "Not connected".
  const titleRef = useRef<HTMLDivElement>(null)
  const disconnecting = useRef(false)
  useEffect(() => {
    if (connected || !disconnecting.current) return
    disconnecting.current = false
    titleRef.current?.focus()
  }, [connected])

  const refresh = () =>
    run(refreshFeedAction, async (data) => {
      await reload()
      return data ? 'The feed was read from Instagram again.' : 'There is no feed to read: no account is connected.'
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle ref={titleRef} id="ig-status" tabIndex={-1} role="heading" aria-level={2} className="flex flex-wrap items-center gap-2 outline-none focus-visible:ring-3 focus-visible:ring-ring">
          Status {connected ? <Badge>Connected</Badge> : <Badge variant="secondary">Not connected</Badge>}
          {connected && expired ? <Badge variant="outline">Access expired</Badge> : null}
        </CardTitle>
        <CardDescription>
          {connected
            ? 'The site reads this account’s profile and latest posts about once an hour.'
            : seesConnection
              ? canConnect
                ? 'No Instagram account is connected yet. Connect one below, in either of two ways.'
                : 'No Instagram account is connected yet. Your role can view this screen but not connect one.'
              : 'No Instagram account is connected yet. An admin or a developer can connect one on this screen.'}
        </CardDescription>
      </CardHeader>
      {connected ? (
        <CardContent className="flex flex-col gap-4 text-sm">
          {account ? (
            <div className="flex items-center gap-3">
              <ProfilePhoto url={account.pictureUrl} username={account.username} className="size-14" />
              <div className="min-w-0">
                {account.name ? <p className="truncate font-medium">{account.name}</p> : null}
                <p className="truncate">@{account.username}</p>
                {account.accountType ? <p className="text-muted-foreground">{ACCOUNT_TYPES[account.accountType] ?? account.accountType}</p> : null}
              </div>
            </div>
          ) : null}

          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
            {connection ? (
              <>
                <dt className="text-muted-foreground">How it was connected</dt>
                <dd>
                  {connection.method ? METHODS[connection.method] : 'Unknown'}
                  {connection.connectedAt ? `, ${formatWhen(connection.connectedAt, timeZone)}` : ''}
                </dd>
                <dt className="text-muted-foreground">Access expires</dt>
                <dd>
                  {connection.tokenExpiresAt
                    ? expired
                      ? `Expired ${formatWhen(connection.tokenExpiresAt, timeZone)}. Connect the account again below.`
                      : formatWhen(connection.tokenExpiresAt, timeZone)
                    : 'Unknown'}
                </dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Feed last read</dt>
            <dd>{lastRead ? formatWhen(lastRead, timeZone) : 'Not yet'}</dd>
          </dl>

          {connection?.lastError ? (
            <div className="rounded-lg border border-destructive p-4">
              <p className="font-medium">The last read from Instagram failed</p>
              <p className="mt-1">{connection.lastError}</p>
              <p className="mt-1 text-muted-foreground">The site keeps showing the posts it read before. Try “Refresh now”; if it fails again, connect the account again.</p>
            </div>
          ) : null}

          {canPin || canConnect ? (
            <div className="flex flex-wrap items-center gap-3">
              {canPin ? (
                <Button type="button" variant="outline" onClick={refresh} aria-disabled={pending || undefined}>
                  {pending ? 'Working…' : 'Refresh now'}
                </Button>
              ) : null}
              {canConnect && connection ? (
                <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                  <AlertDialogTrigger render={<Button type="button" variant="destructive" aria-disabled={pending || undefined} />}>Disconnect</AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Disconnect {account ? `@${account.username}` : 'this account'}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Instagram feed blocks stop showing on the site until an account is connected again, and the pinned posts are forgotten. Pages that use the block
                        are not changed, and the saved app keys stay.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep it connected</AlertDialogCancel>
                      <Button
                        variant="destructive"
                        aria-disabled={pending || undefined}
                        onClick={() => {
                          if (pending) return
                          setConfirmOpen(false)
                          disconnecting.current = true
                          run(disconnectAction, async (view) => {
                            onConnection(view)
                            await reload()
                            return 'The Instagram account was disconnected.'
                          })
                        }}
                      >
                        Disconnect
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  )
}
