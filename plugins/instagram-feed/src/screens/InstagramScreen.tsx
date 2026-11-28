'use client'

import type { ActionResult } from '@pet-adopt/plugin-sdk'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pet-adopt/ui/components/card'
import React, { useRef, useState, useTransition } from 'react'

import { getConnectionAction, getFeedPreviewAction, listRecentPostsAction } from '../actions'
import type { ConnectionView, FeedPost, InstagramFeedData } from '../types'
import { ConnectForms } from './ConnectForms'
import { ConnectionStatus } from './ConnectionStatus'
import { FeedSummary } from './FeedSummary'
import { PinnedPosts } from './PinnedPosts'

/** Runs a server action: on success `done` gets the data and returns the message to announce. */
export type Run = <T>(call: () => Promise<ActionResult<T>>, done: (data: T) => string | Promise<string>) => void

/** Where each field error of the server actions points on this screen. */
const TARGETS: Record<string, { id: string; label: string }> = {
  appId: { id: 'ig-app-id', label: 'App ID' },
  appSecret: { id: 'ig-app-secret', label: 'App secret' },
  clearSecret: { id: 'ig-app-secret', label: 'App secret' },
  token: { id: 'ig-token', label: 'Access token' },
  ids: { id: 'ig-pins', label: 'Pinned posts' },
}

type Props = {
  initialConnection: ConnectionView | null
  initialPosts: FeedPost[]
  initialFeed: InstagramFeedData | null
  /** Something could not be read when the screen opened. */
  loadProblem: string | null
  /** Admins, developers and audit: the keys and the connection are shown. */
  seesConnection: boolean
  /** Admins and developers: may save keys, connect and disconnect. */
  canConnect: boolean
  /** Everyone who may change plugin content: may pin posts and refresh the feed. */
  canPin: boolean
  timeZone: string | null
  /** When the server drew the screen (ISO 8601), to tell whether the access has expired. */
  now: string
}

// The Instagram screen: status, connecting (two ways), pinned posts and a preview. This component
// holds what the server sent and the one place problems are shown: a summary that takes focus and
// links to the fields (one `role="alert"` for the whole screen), plus a polite line for what worked.
export function InstagramScreen({ initialConnection, initialPosts, initialFeed, loadProblem, seesConnection, canConnect, canPin, timeZone, now }: Props) {
  const [connection, setConnection] = useState(initialConnection)
  const [posts, setPosts] = useState(initialPosts)
  const [feed, setFeed] = useState(initialFeed)
  const [problem, setProblem] = useState<{ text: string; fields: Record<string, string> } | null>(null)
  const [notice, setNotice] = useState('')
  const [pending, startTransition] = useTransition()
  const summaryRef = useRef<HTMLDivElement>(null)

  const run: Run = (call, done) => {
    if (pending) return
    startTransition(async () => {
      let failure: { text: string; fields: Record<string, string> } | null = null
      try {
        const result = await call()
        if (result.ok) {
          const text = await done(result.data)
          setProblem(null)
          setNotice(text)
          return
        }
        failure = { text: result.error, fields: result.fieldErrors ?? {} }
      } catch {
        failure = { text: 'The site could not be reached. Check your connection and try again.', fields: {} }
      }
      setNotice('')
      setProblem(failure)
      requestAnimationFrame(() => summaryRef.current?.focus())
    })
  }

  /** After the connection or the feed changed: read the posts, the preview and the status again. */
  const reload = async () => {
    const [nextPosts, nextFeed, nextConnection] = await Promise.all([listRecentPostsAction(), getFeedPreviewAction(), seesConnection ? getConnectionAction() : null])
    if (nextPosts.ok) setPosts(nextPosts.data)
    if (nextFeed.ok) setFeed(nextFeed.data)
    if (nextConnection?.ok) setConnection(nextConnection.data)
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        The connected account appears on the site through the page builder’s Instagram feed block.{' '}
        <strong className="font-medium text-foreground">Only Instagram Business and Creator accounts can be connected; personal accounts are refused.</strong>{' '}
        A personal account can be switched to a professional one for free in the Instagram app’s settings.
      </p>

      {loadProblem ? <p className="rounded-lg border border-destructive p-4 text-sm">Part of this screen could not be loaded: {loadProblem}</p> : null}

      {problem ? (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-lg border border-destructive p-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring">
          <p className="font-medium">{problem.text}</p>
          {Object.keys(problem.fields).length > 0 ? (
            <ul className="mt-2 list-disc pl-5">
              {Object.entries(problem.fields).map(([key, message]) => {
                const target = TARGETS[key] ?? { id: 'ig-connect', label: 'Connection' }
                return (
                  <li key={key}>
                    <a href={`#${target.id}`} className="underline underline-offset-4">
                      {target.label}: {message}
                    </a>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      <ConnectionStatus
        connection={connection}
        feed={feed}
        seesConnection={seesConnection}
        canConnect={canConnect}
        canPin={canPin}
        pending={pending}
        run={run}
        reload={reload}
        onConnection={setConnection}
        timeZone={timeZone}
        now={now}
      />

      {seesConnection && connection ? (
        <ConnectForms connection={connection} canConnect={canConnect} pending={pending} run={run} reload={reload} onConnection={setConnection} errors={problem?.fields ?? {}} />
      ) : null}

      <PinnedPosts
        posts={posts}
        canPin={canPin}
        pending={pending}
        run={run}
        onSaved={async (saved) => {
          setPosts(saved)
          const next = await getFeedPreviewAction()
          if (next.ok) setFeed(next.data)
        }}
        error={problem?.fields.ids}
        timeZone={timeZone}
      />

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>Preview</CardTitle>
          <CardDescription>The feed as the dashboard card shows it: the profile, then pinned posts and the latest ones. Each block on the site chooses how many to show.</CardDescription>
        </CardHeader>
        <CardContent>
          {feed ? <FeedSummary feed={feed} timeZone={timeZone} columns="grid-cols-3 sm:grid-cols-5" /> : <p className="text-sm text-muted-foreground">Nothing to preview until an account is connected.</p>}
        </CardContent>
      </Card>

      <p role="status" aria-live="polite" className="text-sm">
        {notice}
      </p>
    </div>
  )
}
