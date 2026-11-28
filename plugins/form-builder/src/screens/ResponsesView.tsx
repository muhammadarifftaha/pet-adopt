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
import { Button, buttonVariants } from '@pet-adopt/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@pet-adopt/ui/components/card'
import { Checkbox } from '@pet-adopt/ui/components/checkbox'
import { Label } from '@pet-adopt/ui/components/label'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React, { useState, useTransition } from 'react'

import { deleteResponsesAction, exportResponsesCsvAction, markResponsesReadAction } from '../actions'
import { answerToText } from '../fields'
import type { FormResponse } from '../server'
import { BASE, editHref, responsesHref } from './paths'


// A form's responses, newest first: each as a card with every answer under the question it was
// given under. Select some to mark as read or delete; download all as CSV. Results of each action
// are announced in a status line; pages are real links (?page=N).
export function ResponsesView({
  form,
  list,
  canEdit = true,
  canExport = true,
  timeZone = null,
}: {
  form: { id: number; name: string }
  list: { items: FormResponse[]; total: number; page: number; totalPages: number }
  /** Mark as read and delete (personalData:edit). Off for view-only roles (audit). */
  canEdit?: boolean
  /** Download as CSV (personalData:export). Audit may read responses but not take a copy. */
  canExport?: boolean
  /** The site's time zone (`host().timeZone()`), which the times are shown in. */
  timeZone?: string | null
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<number[]>([])
  const [status, setStatus] = useState('')
  const [pending, startTransition] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const allIds = list.items.map((item) => item.id)
  // Only what is on screen can be acted on: the screen is remounted per page (Responses.tsx), and this
  // also drops ids that left the page after a refresh, so Delete never removes a response nobody sees.
  const picked = selected.filter((id) => allIds.includes(id))
  const allSelected = allIds.length > 0 && allIds.every((id) => picked.includes(id))
  const toggle = (id: number, on: boolean) => setSelected((current) => (on ? [...new Set([...current, id])] : current.filter((x) => x !== id)))

  function act(fn: () => Promise<{ ok: true; data: number } | { ok: false; error: string }>, done: (n: number) => string) {
    if (pending) return
    startTransition(async () => {
      const result = await fn()
      if (!result.ok) return setStatus(result.error)
      setSelected([])
      setStatus(done(result.data))
      router.refresh()
    })
  }

  function exportCsv() {
    if (pending || list.total === 0) return
    startTransition(async () => {
      const result = await exportResponsesCsvAction(form.id)
      if (!result.ok) return setStatus(result.error)
      const url = URL.createObjectURL(new Blob([result.data.csv], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = result.data.filename
      link.click()
      URL.revokeObjectURL(url)
      setStatus(`Downloaded ${result.data.filename}.`)
    })
  }

  const plural = (n: number) => `${n} ${n === 1 ? 'response' : 'responses'}`

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link href={BASE} className="underline underline-offset-4">
          All forms
        </Link>
        <span aria-hidden="true">·</span>
        <Link href={editHref(form.id)} className="underline underline-offset-4">
          Edit “{form.name}”
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">
          {plural(list.total)} to “{form.name}”
        </p>
        {canExport ? (
          <Button type="button" variant="outline" size="sm" onClick={exportCsv} aria-disabled={pending || list.total === 0 || undefined}>
            Download CSV
          </Button>
        ) : null}
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => list.total > 0 && act(() => markResponsesReadAction(form.id), (n) => (n ? `${plural(n)} marked as read.` : 'Everything was already read.'))}
            aria-disabled={pending || list.total === 0 || undefined}
          >
            Mark all as read
          </Button>
        ) : null}
      </div>

      {list.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No responses yet</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Add the form to a page with the page builder&apos;s Form block. Responses appear here.</CardContent>
        </Card>
      ) : (
        <>
          {canEdit ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Checkbox id="fb-select-all" checked={allSelected} onCheckedChange={(checked) => setSelected(checked === true ? allIds : [])} />
              <Label htmlFor="fb-select-all">Select all on this page</Label>
            </div>
            <span className="text-sm text-muted-foreground">{picked.length} selected</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              aria-disabled={pending || !picked.length || undefined}
              onClick={() => picked.length > 0 && act(() => markResponsesReadAction(form.id, picked), (n) => `${plural(n)} marked as read.`)}
            >
              Mark as read
            </Button>
            <AlertDialog open={confirmOpen} onOpenChange={(open) => setConfirmOpen(open && picked.length > 0)}>
              <AlertDialogTrigger render={<Button type="button" variant="destructive" size="sm" aria-disabled={pending || !picked.length || undefined} />}>Delete</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {plural(picked.length)}?</AlertDialogTitle>
                  <AlertDialogDescription>They are removed for good, including from the CSV. Download it first if you need a copy.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep them</AlertDialogCancel>
                  <Button
                    variant="destructive"
                    aria-disabled={pending || undefined}
                    onClick={() => {
                      if (pending) return
                      setConfirmOpen(false)
                      act(() => deleteResponsesAction(form.id, picked), (n) => `${plural(n)} deleted.`)
                    }}
                  >
                    Delete
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          ) : (
            <p className="rounded-md border bg-muted px-3 py-2 text-sm">
              <span className="font-medium">View only.</span> Your role can read these responses but not change{canExport ? '' : ' or download'} them.
            </p>
          )}

          <ol className="flex flex-col gap-3">
            {list.items.map((item) => (
              <li key={item.id}>
                <Card>
                  <CardHeader className="flex flex-row flex-wrap items-center gap-3">
                    {canEdit ? (
                      <>
                        <Checkbox id={`fb-response-${item.id}`} checked={selected.includes(item.id)} onCheckedChange={(checked) => toggle(item.id, checked === true)} />
                        <Label htmlFor={`fb-response-${item.id}`} className="font-medium">
                          Response from {formatWhen(item.createdAt, timeZone)}
                        </Label>
                      </>
                    ) : (
                      <span className="font-medium">Response from {formatWhen(item.createdAt, timeZone)}</span>
                    )}
                    {!item.readAt && <Badge>New</Badge>}
                  </CardHeader>
                  <CardContent>
                    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(8rem,14rem)_1fr]">
                      {item.answers.map((answer) => (
                        <React.Fragment key={answer.id}>
                          <dt className="text-muted-foreground">{answer.label}</dt>
                          <dd className="whitespace-pre-wrap break-words">{answerToText(answer) || <span className="text-muted-foreground">No answer</span>}</dd>
                        </React.Fragment>
                      ))}
                    </dl>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>

          {list.totalPages > 1 && (
            <nav aria-label="Responses pages" className="flex items-center gap-2">
              {list.page > 1 ? (
                <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} href={responsesHref(form.id, list.page - 1)}>
                  Newer
                </Link>
              ) : null}
              <span className="text-sm text-muted-foreground">
                Page {list.page} of {list.totalPages}
              </span>
              {list.page < list.totalPages ? (
                <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} href={responsesHref(form.id, list.page + 1)}>
                  Older
                </Link>
              ) : null}
            </nav>
          )}
        </>
      )}

      <p role="status" className="text-sm text-muted-foreground">
        {status}
      </p>
    </div>
  )
}
