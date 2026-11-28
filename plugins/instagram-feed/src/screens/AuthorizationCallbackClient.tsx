'use client'

import { buttonVariants } from '@pet-adopt/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pet-adopt/ui/components/card'
import Link from 'next/link'
import React, { useEffect, useRef, useState } from 'react'

import { completeAuthorizationAction } from '../actions'
import { BASE, callbackHref } from './paths'

type Outcome = { kind: 'working' } | { kind: 'done'; username: string | null } | { kind: 'failed'; text: string }

const REFUSED = {
  denied: 'You chose not to give access on Instagram, so nothing was connected. Nothing on the site has changed.',
  failed: 'Instagram did not finish its sign-in, so nothing was connected. Nothing on the site has changed.',
}
const NOTHING = 'There is no Instagram sign-in to finish here. Start again from the Instagram feed screen.'

// The last step of connecting through Instagram's sign-in. It runs by itself, once, as soon as the
// screen opens, instead of waiting for a button:
//   - the code Instagram hands back is short-lived and works once, so waiting only lets it expire;
//   - a button adds no protection: the one-time `state` (checked on the server against the sign-in
//     this person started) is what stops a link made by someone else from connecting anything;
//   - the person already pressed "Connect with Instagram" and agreed on Instagram.
// The code and the state are taken out of the address bar straight away (and so out of the
// browser's history), and are never drawn. Reloading the screen then finds nothing to finish.
export function AuthorizationCallbackClient({ code, state, refused }: { code: string; state: string; refused: 'denied' | 'failed' | null }) {
  const canFinish = !refused && Boolean(code) && Boolean(state)
  const [outcome, setOutcome] = useState<Outcome>(canFinish ? { kind: 'working' } : { kind: 'failed', text: refused ? REFUSED[refused] : NOTHING })
  // Development runs effects twice; the code only works once.
  const started = useRef(false)

  useEffect(() => {
    // Whatever Instagram sent back (a code and a state, or an error and its description) leaves the
    // address bar, and with it the "#_" Instagram adds to the address.
    if (window.location.search || window.location.hash) window.history.replaceState(null, '', callbackHref)
    if (!canFinish || started.current) return
    started.current = true
    completeAuthorizationAction({ code, state }).then(
      (result) =>
        setOutcome(result.ok ? { kind: 'done', username: result.data.account?.username ?? null } : { kind: 'failed', text: result.error }),
      () => setOutcome({ kind: 'failed', text: 'The site could not be reached. Check your connection and connect again.' }),
    )
  }, [canFinish, code, state])

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>{outcome.kind === 'working' ? 'Connecting Instagram…' : outcome.kind === 'done' ? 'Instagram is connected' : 'Instagram was not connected'}</CardTitle>
        <CardDescription>The last step of connecting through Instagram’s own sign-in.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <p role="status" aria-live="polite" className={outcome.kind === 'failed' ? 'text-destructive' : undefined}>
          {outcome.kind === 'working'
            ? 'Finishing the connection with Instagram. This takes a few seconds; keep this page open.'
            : outcome.kind === 'done'
              ? `${outcome.username ? `@${outcome.username} is connected.` : 'The account is connected.'} Its latest posts are ready for the Instagram feed block.`
              : outcome.text}
        </p>
        {outcome.kind === 'working' ? null : (
          <Link href={BASE} className={`${buttonVariants({ variant: outcome.kind === 'done' ? 'default' : 'outline' })} self-start`}>
            {outcome.kind === 'done' ? 'Back to Instagram feed' : 'Try again'}
          </Link>
        )}
      </CardContent>
    </Card>
  )
}
