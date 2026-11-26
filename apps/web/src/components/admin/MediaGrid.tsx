'use client'

import { useViewOnly } from '@/components/admin/view-only'
import Link from 'next/link'
import React from 'react'
import { FiCheckSquare, FiTrash2, FiX } from 'react-icons/fi'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@pet-adopt/ui/components/alert-dialog'
import { Button } from '@pet-adopt/ui/components/button'
import { Checkbox } from '@pet-adopt/ui/components/checkbox'
import { Separator } from '@pet-adopt/ui/components/separator'
import { Toggle } from '@pet-adopt/ui/components/toggle'
import { useInvalidateMedia } from '@/lib/admin/media-cache'
import { cn } from '@/lib/utils'
import { deleteManyMediaAction } from '@/server/actions/media'

// The media library grid and its toolbar. The "Select images" toggle picks the mode: off, each tile
// links to the image's own page (/admin/media/<id>); on, tiles are selectable (a checkbox in the
// top right corner, or a click on the picture; Shift selects a range) and a bulk-actions bar slides
// up and docks at the bottom of the screen: select the whole page, clear, and delete after a
// confirmation. Images still in use are skipped with their reason and stay selected. The selection
// covers the page on screen (`pageKey` changes on another page, size or search); the toggle stays
// as it is. Each tile shows the image's name under it. Results are announced in a live region;
// problems in an alert. Changes refresh the SWR library cache (`useInvalidateMedia`).

type Item = { id: number; thumbnailUrl: string; alt: string; name: string | null }
type Outcome = { text: string; problems: string[]; key: number }

export function MediaGrid({
  items,
  pageKey,
  toolbarStart,
  toolbarEnd,
  empty,
  busy = false,
}: {
  items: Item[]
  pageKey: string
  /** Shown first in the toolbar row, before a divider (the page's Upload button). */
  toolbarStart?: React.ReactNode
  /** Shown at the end of the toolbar row (the search box). */
  toolbarEnd?: React.ReactNode
  /** Shown instead of the grid when there are no items. */
  empty?: React.ReactNode
  /** The next page or search is loading: the current one stays, dimmed. */
  busy?: boolean
}) {
  const invalidateMedia = useInvalidateMedia()
  const viewOnly = useViewOnly()
  const [selecting, setSelecting] = React.useState(false)
  const [anchor, setAnchor] = React.useState<number | null>(null)
  const [chosen, setChosen] = React.useState<Set<number>>(() => new Set())
  // Another page of the library: start with nothing selected.
  const [shownKey, setShownKey] = React.useState(pageKey)
  if (shownKey !== pageKey) {
    setShownKey(pageKey)
    setChosen(new Set())
    setAnchor(null)
  }
  const [confirming, setConfirming] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const [outcome, setOutcome] = React.useState<Outcome | null>(null)

  // Ids that left the page (deleted, refreshed) drop out of the selection by themselves.
  const selected = items.filter((item) => chosen.has(item.id))
  const count = selected.length
  const all = count > 0 && count === items.length
  const some = count > 0 && !all

  const setSelectMode = (on: boolean) => {
    setSelecting(on)
    setChosen(new Set())
    setAnchor(null)
    setOutcome(null)
  }

  const toggle = (index: number, checked: boolean, shiftKey: boolean) => {
    const next = new Set(chosen)
    // Shift-click: everything between the last clicked tile and this one follows this tile.
    const [from, to] = shiftKey && anchor !== null ? [Math.min(anchor, index), Math.max(anchor, index)] : [index, index]
    for (const item of items.slice(from, to + 1)) {
      if (checked) next.add(item.id)
      else next.delete(item.id)
    }
    setChosen(next)
    setAnchor(index)
  }

  const deleteSelected = () => {
    setConfirming(false)
    const ids = selected.map((item) => item.id)
    startTransition(async () => {
      const result = await deleteManyMediaAction(ids)
      if (!result.ok) {
        setOutcome({ text: '', problems: [result.error], key: Date.now() })
        return
      }
      const { deleted, failed } = result.data
      const altOf = (id: number) => {
        const item = items.find((entry) => entry.id === id)
        return item?.name || item?.alt || `Image ${id}`
      }
      setChosen(new Set(failed.map((entry) => entry.id)))
      setOutcome({
        text: deleted.length ? `Deleted ${deleted.length} ${deleted.length === 1 ? 'image' : 'images'}.` : '',
        problems: failed.map((entry) => `“${altOf(entry.id)}”: ${entry.message}`),
        key: Date.now(),
      })
      void invalidateMedia()
    })
  }

  return (
    <div className={cn('flex flex-col gap-4', selecting && 'pb-28')}>
      <div className="flex flex-wrap items-center gap-3">
        {toolbarStart && !viewOnly ? (
          <>
            {toolbarStart}
            {/* Decorative: it only separates the upload from the selection tools. */}
            <Separator orientation="vertical" className="data-vertical:h-6 data-vertical:self-center" />
          </>
        ) : null}
        {/* The label says what pressing it does next. Base UI's Toggle also reports aria-pressed. */}
        {/* Selecting is only for deleting: view-only roles get the plain grid of links. */}
        {viewOnly ? null : (
          <Toggle variant="outline" pressed={selecting} onPressedChange={(on) => setSelectMode(on)}>
            {selecting ? <FiX aria-hidden /> : <FiCheckSquare aria-hidden />}
            {selecting ? 'Cancel' : 'Select images'}
          </Toggle>
        )}
        <p className="hidden text-sm text-muted-foreground xl:block">
          {selecting ? 'Pick images with their checkbox or a click. Shift selects a range.' : 'Open an image to see where it is used.'}
        </p>
        {toolbarEnd ? <div className="ml-auto w-full sm:w-auto">{toolbarEnd}</div> : null}
      </div>

      <div aria-live="polite" className="sr-only">
        {outcome?.text}
      </div>
      {outcome && (outcome.text || outcome.problems.length) ? (
        <div key={outcome.key} className="flex flex-col gap-1 text-sm">
          {outcome.text ? <p>{outcome.text}</p> : null}
          {outcome.problems.length ? (
            <div role="alert" className="text-destructive">
              <p>
                {outcome.problems.length === 1 ? 'One image was not deleted:' : `${outcome.problems.length} images were not deleted:`}
              </p>
              <ul className="list-disc pl-5">
                {outcome.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {items.length === 0 ? empty : null}
      <ul
        className={cn('grid grid-cols-2 gap-4 transition-opacity sm:grid-cols-3 lg:grid-cols-6', busy && 'opacity-60', items.length === 0 && 'hidden')}
        aria-busy={busy || undefined}
      >
        {items.map((item, index) => {
          const isSelected = selecting && chosen.has(item.id)
          const image = (
            <>
              {/* Its own frame, so the hover zoom stays clear of the caption. */}
              <div className="overflow-hidden">
                {/* Hover (or keyboard focus) zooms the picture a little: it reads as clickable. No
                    zoom for people who ask for reduced motion; the border and shadow stay. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.thumbnailUrl}
                  alt={item.alt}
                  className="aspect-square w-full object-cover transition-transform duration-200 ease-out group-focus-within/tile:scale-105 group-hover/tile:scale-105 motion-reduce:transition-none motion-reduce:group-focus-within/tile:scale-100 motion-reduce:group-hover/tile:scale-100"
                />
              </div>
              <p className="truncate border-t px-2 py-1.5 text-xs" title={item.name ?? undefined}>
                {item.name ?? <span className="text-muted-foreground italic">Untitled</span>}
              </p>
            </>
          )
          return (
            <li
              key={item.id}
              className={cn(
                'group/tile relative scroll-mb-32 overflow-hidden rounded-lg border transition-[border-color,box-shadow] duration-200 hover:border-foreground/40 hover:shadow-md',
                isSelected && 'ring-2 ring-ring ring-offset-2 ring-offset-background')}
            >
              {selecting ? (
                <>
                  {/* A click on the picture toggles it too (the checkbox is the keyboard way). */}
                  <div className="cursor-pointer" onClick={(event) => toggle(index, !isSelected, event.shiftKey)}>
                    {image}
                  </div>
                  {/* Hidden until the tile is hovered or the box is checked. Opacity, not display, so
                      it stays in the tab order, and it shows on keyboard focus, while anything on the
                      page is selected, and always on touch screens (no hover there). */}
                  <span
                    className={cn(
                      'absolute top-2 right-2 flex p-1.5 opacity-0 transition-opacity group-hover/tile:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100',
                      (isSelected || count > 0) && 'opacity-100',
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked, details) => toggle(index, checked, Boolean((details.event as MouseEvent | undefined)?.shiftKey))}
                      aria-label={`Select ${item.name || item.alt || `image ${item.id}`}`}
                    />
                  </span>
                </>
              ) : (
                // The link's name is the picture's alt text plus the caption (its name).
                <Link href={`/admin/media/${item.id}`} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  {image}
                </Link>
              )}
            </li>
          )
        })}
      </ul>

      {/* The bulk actions dock at the bottom of the screen while selecting and slide away after.
          When hidden it is `inert` (out of the tab order and the accessibility tree). It sits beside
          the sidebar on wide screens, and the grid gets bottom padding and scroll margins so the
          bar never covers a focused tile (WCAG 2.4.11). */}
      <div
        className={cn(
          'pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] transition-[translate,opacity] duration-300 ease-out motion-reduce:transition-none',
          'md:group-has-[[data-slot=sidebar][data-state=expanded]]/sidebar-wrapper:left-(--sidebar-width)',
          selecting ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0',
        )}
        inert={!selecting}
      >
        <div
          role="group"
          aria-label="Bulk actions"
          className="pointer-events-auto flex w-full max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-popover px-4 py-3 text-popover-foreground shadow-lg"
        >
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={all}
              indeterminate={some}
              onCheckedChange={(checked) => {
                setChosen(checked ? new Set(items.map((item) => item.id)) : new Set())
                setAnchor(null)
              }}
            />
            Select all on this page
          </label>
          <p className="text-sm font-medium tabular-nums" aria-live="polite">
            {count === 0 ? 'No images selected' : `${count} selected`}
          </p>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {count > 0 ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setChosen(new Set())}>
                <FiX aria-hidden />
                Clear
              </Button>
            ) : null}
            {/* aria-disabled, not disabled: keeps it focusable and announced while nothing is selected. */}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              aria-disabled={count === 0 || pending}
              onClick={() => count > 0 && !pending && setConfirming(true)}
            >
              <FiTrash2 aria-hidden />
              {pending ? 'Deleting…' : 'Delete selected'}
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {count} {count === 1 ? 'image' : 'images'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They are removed for good. Images still used by a pet, a page or the site settings are skipped, and you will see where
              they are used.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <Button variant="destructive" onClick={deleteSelected}>
              Delete {count === 1 ? 'image' : 'images'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
