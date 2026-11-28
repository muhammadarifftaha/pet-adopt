'use client'

import { formatWhen } from '@pet-adopt/plugin-sdk'
import { Badge } from '@pet-adopt/ui/components/badge'
import { Button } from '@pet-adopt/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pet-adopt/ui/components/card'
import React, { useState } from 'react'

import { setPinnedPostsAction } from '../actions'
import { MAX_PINNED, type FeedPost } from '../types'
import { KIND_LABEL, PostPicture, postAlt } from './FeedSummary'
import type { Run } from './InstagramScreen'

type Props = {
  /** The latest posts, pinned ones marked (and, among themselves, in their pinned order). */
  posts: FeedPost[]
  canPin: boolean
  pending: boolean
  run: Run
  onSaved: (posts: FeedPost[]) => Promise<void>
  /** The server's complaint about the pins, when the last save failed. */
  error?: string
  timeZone: string | null
}

// Choosing pinned posts: each post is a real checkbox (its picture is the label's content), the
// order of the pins is the order they were ticked, and "Move earlier" / "Move later" change it
// (nothing here needs dragging). A hidden live region says what each press did.
export function PinnedPosts({ posts, canPin, pending, run, onSaved, error, timeZone }: Props) {
  const saved = posts.filter((post) => post.pinned).map((post) => post.id)
  const [order, setOrder] = useState(saved)
  const [announcement, setAnnouncement] = useState('')
  // Start again from what the server holds whenever the list is read again. Done here, not with a
  // `key` on this component: a remount would drop the keyboard focus (on "Save pins") to the page.
  const held = posts.map((post) => `${post.id}:${post.pinned ? 1 : 0}`).join(',')
  const [shown, setShown] = useState(held)
  if (shown !== held) {
    setShown(held)
    setOrder(saved)
  }
  // The same sentence twice in a row is not read out again, so a repeat alternates an invisible ending.
  const announce = (text: string) => setAnnouncement((last) => (last === text ? `${text}\u00A0` : text))
  const byId = new Map(posts.map((post) => [post.id, post]))
  const changed = order.join(',') !== saved.join(',')
  const full = order.length >= MAX_PINNED
  const nameOf = (post: FeedPost) => `the post of ${formatWhen(post.postedAt, timeZone, 'date')}`

  const toggle = (post: FeedPost) => {
    if (order.includes(post.id)) {
      const next = order.filter((id) => id !== post.id)
      setOrder(next)
      setAnnouncement(`Unpinned ${nameOf(post)}. ${next.length} of ${MAX_PINNED} pinned.`)
    } else if (full) {
      announce(`${MAX_PINNED} posts are pinned already, which is the most. Unpin one first.`)
    } else {
      setOrder([...order, post.id])
      setAnnouncement(`Pinned ${nameOf(post)} as number ${order.length + 1}. ${order.length + 1} of ${MAX_PINNED} pinned.`)
    }
  }

  const move = (id: string, by: -1 | 1) => {
    const from = order.indexOf(id)
    const to = from + by
    if (from < 0 || to < 0 || to >= order.length) return
    const next = [...order]
    ;[next[from], next[to]] = [next[to], next[from]]
    setOrder(next)
    const post = byId.get(id)
    setAnnouncement(`Moved ${post ? nameOf(post) : 'the post'} to number ${to + 1} of ${next.length}.`)
  }

  const save = () =>
    run(
      () => setPinnedPostsAction({ ids: order }),
      async (next) => {
        await onSaved(next)
        return order.length === 0 ? 'Saved. No posts are pinned.' : `Saved. ${order.length} ${order.length === 1 ? 'post is' : 'posts are'} pinned.`
      },
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle id="ig-pins" tabIndex={-1} role="heading" aria-level={2} className="flex flex-wrap items-center gap-2 outline-none">
          Pinned posts{' '}
          <Badge variant="secondary">
            {order.length} of {MAX_PINNED}
          </Badge>
        </CardTitle>
        <CardDescription id="ig-pins-note">
          Pin up to {MAX_PINNED} posts to keep them at the start of the feed, in the order you choose. Pinned posts count towards each block’s number of posts,
          and a block can leave them out.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        {posts.length === 0 ? (
          <p className="text-muted-foreground">There are no posts to choose from yet. They appear here once an account is connected and its feed has been read.</p>
        ) : (
          <>
            <fieldset disabled={!canPin} aria-describedby={error ? 'ig-pins-note ig-pins-error' : 'ig-pins-note'} className="m-0 min-w-0 border-0 p-0">
              <legend className="mb-2 font-medium">Latest posts</legend>
              <ul className="grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-4 md:grid-cols-5">
                {posts.map((post) => {
                  const position = order.indexOf(post.id)
                  const checked = position >= 0
                  const blocked = !checked && full
                  return (
                    <li key={post.id}>
                      <label className={`flex cursor-pointer flex-col gap-1.5 rounded-lg border p-1.5 has-focus-visible:ring-3 has-focus-visible:ring-ring ${checked ? 'border-primary bg-muted' : ''} ${blocked ? 'opacity-60' : ''}`}>
                        <PostPicture post={post} alt="" />
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            // Not `disabled` at the limit: the box keeps focus and explains itself instead.
                            aria-disabled={blocked || undefined}
                            onChange={() => toggle(post)}
                          />
                          <span>
                            {checked ? `Pinned, number ${position + 1}` : 'Pin'}
                            {/* The caption only: the date is the next line, and a post without a caption is named by it. */}
                            {post.alt.trim() ? <span className="sr-only">: {post.alt.trim()}</span> : null}
                            <span className="sr-only">, </span>
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          <span className="sr-only">{KIND_LABEL[post.kind] ?? 'Post'} posted </span>
                          {formatWhen(post.postedAt, timeZone, 'date')}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </fieldset>
            {error ? (
              <p id="ig-pins-error" className="text-destructive">
                {error}
              </p>
            ) : null}
            {full && canPin ? <p className="text-muted-foreground">{MAX_PINNED} posts are pinned, which is the most. Unpin one to pin another.</p> : null}

            {order.length > 0 ? (
              <div>
                <h3 className="mb-2 font-medium">Order of the pinned posts</h3>
                <ol className="flex list-none flex-col gap-2 p-0">
                  {order.map((id, index) => {
                    const post = byId.get(id)
                    if (!post) return null
                    const label = `post ${index + 1}, ${formatWhen(post.postedAt, timeZone, 'date')}`
                    return (
                      <li key={id} className="flex flex-wrap items-center gap-3 rounded-lg border p-2">
                        <span className="w-12 shrink-0">
                          <PostPicture post={post} alt="" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{index + 1}.</span> <span className="break-words">{postAlt(post, timeZone)}</span>
                        </span>
                        {canPin ? (
                          <span className="flex flex-wrap items-center gap-2">
                            <Button type="button" variant="outline" size="sm" aria-label={`Move earlier: ${label}`} aria-disabled={pending || index === 0 || undefined} onClick={() => !pending && move(id, -1)}>
                              Move earlier
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              aria-label={`Move later: ${label}`}
                              aria-disabled={pending || index === order.length - 1 || undefined}
                              onClick={() => !pending && move(id, 1)}
                            >
                              Move later
                            </Button>
                            <Button type="button" variant="outline" size="sm" aria-label={`Unpin: ${label}`} aria-disabled={pending || undefined} onClick={() => !pending && toggle(post)}>
                              Unpin
                            </Button>
                          </span>
                        ) : null}
                      </li>
                    )
                  })}
                </ol>
              </div>
            ) : null}

            {canPin ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => changed && save()} aria-disabled={pending || !changed || undefined} aria-describedby="ig-pins-state">
                  {pending ? 'Working…' : 'Save pins'}
                </Button>
                <span id="ig-pins-state" className="text-muted-foreground">
                  {changed ? 'You have changes that are not saved.' : 'Nothing to save.'}
                </span>
              </div>
            ) : (
              <p className="text-muted-foreground">Your role can view the pinned posts but not change them.</p>
            )}
          </>
        )}
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </CardContent>
    </Card>
  )
}
