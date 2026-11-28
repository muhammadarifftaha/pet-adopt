"use client";

import React from "react";
import Image from "next/image";
import useSWR from "swr";
import { dayInZone } from "@pet-adopt/plugin-sdk";
import { FiEdit2, FiPlus, FiTrash2 } from "react-icons/fi";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@pet-adopt/ui/components/alert-dialog";
import { Button } from "@pet-adopt/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader } from "@pet-adopt/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@pet-adopt/ui/components/dialog";
import { useSiteTimeZone } from "@/components/admin/site-time";
import { useViewOnly } from "@/components/admin/view-only";
import { timelineDateTimeAttr, timelineWhenText } from "@/components/site/timeline-format";
import { unwrapResult } from "@/lib/admin/unwrap-client";
import { compareTimelineNewestFirst, TIMELINE_MAX_ENTRIES, type TimelineEntry } from "@/lib/pet-timeline";
import { richTextToPlain } from "@/lib/rich-text";
import { cn } from "@/lib/utils";
import { deletePetTimelineEntryAction, listPetTimelineAction } from "@/server/actions/pet-timeline";

import { TimelineEntryForm } from "./TimelineEntryForm";

// A pet's timeline on its edit page: dated updates shown on the pet's page by the Pet timeline block.
// It sits below the pet form, outside its <form>: each update is added, edited or deleted on its own
// (its own actions), never saved with the pet, and saving the pet never touches the updates.
//
// The list is SWR (key ["pet-timeline", id], seeded by the server page), updated from what each
// action returns, so nothing reloads. Accessibility: the editor is a dialog (focus trapped, Escape
// closes it, focus goes back to the button that opened it, or to the entry after an edit); delete asks
// first and then moves focus to the next entry (or the Add button); "Update added", "Update saved" and
// "Update deleted" go through a polite live region. View-only roles see the list without the buttons.

const TIMELINE_KEY = "pet-timeline";
const buttonId = (entryId: number, kind: "edit" | "delete") => `timeline-entry-${entryId}-${kind}`;
const ADD_ID = "timeline-add";

const sortNewest = (entries: TimelineEntry[]) => [...entries].sort(compareTimelineNewestFirst);

function focusById(id: string) {
  requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(id)?.focus()));
}

export function PetTimeline({ petId, petName, initial }: { petId: number; petName: string; initial: TimelineEntry[] }) {
  const viewOnly = useViewOnly();
  const timeZone = useSiteTimeZone();
  const key = [TIMELINE_KEY, petId] as const;
  const { data, error, mutate } = useSWR(key, async () => unwrapResult(await listPetTimelineAction(petId)), {
    fallbackData: initial,
  });
  const entries = sortNewest(data ?? []);

  /** "new", an entry being edited, or null when the editor is closed. */
  const [editing, setEditing] = React.useState<TimelineEntry | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<TimelineEntry | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState("");
  /** Where focus goes when the editor closes (the Add button, or the edited entry's Edit button). */
  const returnTo = React.useRef<string | null>(null);
  const deleted = React.useRef(false);

  const full = entries.length >= TIMELINE_MAX_ENTRIES;

  function openEditor(target: TimelineEntry | "new") {
    returnTo.current = target === "new" ? ADD_ID : buttonId(target.id, "edit");
    setEditing(target);
  }

  function saved(entry: TimelineEntry) {
    const isNew = editing === "new";
    void mutate((current) => sortNewest([...(current ?? []).filter((item) => item.id !== entry.id), entry]), {
      revalidate: false,
    });
    returnTo.current = isNew ? ADD_ID : buttonId(entry.id, "edit");
    setEditing(null);
    setAnnouncement(isNew ? `Update added: “${entry.title}”` : `Update saved: “${entry.title}”`);
  }

  async function confirmDelete() {
    if (!deleting || busy) return;
    setBusy(true);
    setDeleteError(null);
    const result = await deletePetTimelineEntryAction(deleting.id);
    setBusy(false);
    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }
    const index = entries.findIndex((item) => item.id === deleting.id);
    const rest = entries.filter((item) => item.id !== deleting.id);
    const neighbour = rest[index] ?? rest[index - 1];
    void mutate(rest, { revalidate: false });
    deleted.current = true;
    setDeleting(null);
    setAnnouncement(`Update deleted: “${deleting.title}”`);
    // The Delete button that opened the dialog is gone: focus the next entry, or the Add button.
    focusById(neighbour ? buttonId(neighbour.id, viewOnly ? "edit" : "delete") : ADD_ID);
  }

  return (
    <section aria-labelledby="pet-timeline-heading" className="mt-10">
      <Card>
        <CardHeader>
          <h2 id="pet-timeline-heading" className="text-base font-semibold">
            Timeline
          </h2>
          <CardDescription>
            Dated updates about {petName}, shown on the pet&apos;s page by the Pet timeline block. Each update saves on
            its own: the pet&apos;s details above are not saved with it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {viewOnly ? null : (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                id={ADD_ID}
                aria-disabled={full || undefined}
                className={cn(full && "opacity-50")}
                onClick={() => (full ? setAnnouncement(`A pet can have at most ${TIMELINE_MAX_ENTRIES} updates.`) : openEditor("new"))}
              >
                <FiPlus aria-hidden="true" />
                Add update
              </Button>
              {full ? (
                <span className="text-sm text-muted-foreground">
                  {petName} has {TIMELINE_MAX_ENTRIES} updates, the most a pet can have. Delete one to add another.
                </span>
              ) : null}
            </div>
          )}

          {error && !data?.length ? (
            <p className="text-sm text-destructive">The updates could not be loaded: {error.message}</p>
          ) : null}

          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No updates yet.{viewOnly ? "" : " Add the first one, for example the day they arrived."}
            </p>
          ) : (
            <ol className="flex flex-col divide-y rounded-lg border" aria-label={`Updates about ${petName}, newest first`}>
              {entries.map((entry) => (
                <TimelineRow
                  key={entry.id}
                  entry={entry}
                  viewOnly={viewOnly}
                  onEdit={() => openEditor(entry)}
                  onDelete={() => {
                    deleted.current = false;
                    setDeleteError(null);
                    setDeleting(entry);
                  }}
                />
              ))}
            </ol>
          )}

          <p role="status" aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(open) => (open ? null : setEditing(null))}>
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
          finalFocus={() => (returnTo.current ? document.getElementById(returnTo.current) : null) ?? true}
        >
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add update" : "Edit update"}</DialogTitle>
            <DialogDescription>
              {editing === "new"
                ? `A new update on ${petName}'s timeline. The other updates are not changed.`
                : "Only this update is changed."}
            </DialogDescription>
          </DialogHeader>
          {/* Mounted only while open, so it starts from the entry (or a blank update) each time. */}
          {editing !== null ? (
            <TimelineEntryForm
              petId={petId}
              entry={editing === "new" ? null : editing}
              today={dayInZone(new Date(), timeZone)}
              onSaved={saved}
              onCancel={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => (open ? null : setDeleting(null))}>
        <AlertDialogContent finalFocus={() => !deleted.current}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this update?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? `“${deleting.title}” (${timelineWhenText(deleting)}) is removed from ${petName}'s timeline for good. Its photos stay in the media library.` : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button variant="destructive" aria-disabled={busy} className={cn(busy && "opacity-50")} onClick={confirmDelete}>
              {busy ? "Deleting…" : "Delete update"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function TimelineRow({
  entry,
  viewOnly,
  onEdit,
  onDelete,
}: {
  entry: TimelineEntry;
  viewOnly: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const preview = entry.body ? richTextToPlain(entry.body).replace(/\s+/g, " ").trim() : "";
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <time dateTime={timelineDateTimeAttr(entry)}>{timelineWhenText(entry, true, "date")}</time>
        </p>
        <h3 className="font-medium">{entry.title}</h3>
        {preview ? <p className="line-clamp-2 text-sm">{preview}</p> : null}
        {entry.photos.length > 0 ? (
          <ul className="mt-1 flex flex-wrap gap-2" aria-label={`${entry.photos.length} photo${entry.photos.length === 1 ? "" : "s"}`}>
            {entry.photos.map((photo, index) => (
              <li key={`${photo.url}-${index}`}>
                <Image
                  src={photo.thumbnailUrl ?? photo.url}
                  alt={photo.alt}
                  width={64}
                  height={48}
                  className="h-12 w-16 rounded object-cover"
                />
              </li>
            ))}
          </ul>
        ) : null}
        {entry.createdByName ? (
          <p className="text-xs text-muted-foreground">Added by {entry.createdByName}</p>
        ) : null}
      </div>
      {viewOnly ? null : (
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" id={buttonId(entry.id, "edit")} aria-label={`Edit update: ${entry.title}`} onClick={onEdit}>
            <FiEdit2 aria-hidden="true" />
            Edit
          </Button>
          <Button type="button" variant="outline" size="sm" id={buttonId(entry.id, "delete")} aria-label={`Delete update: ${entry.title}`} onClick={onDelete}>
            <FiTrash2 aria-hidden="true" />
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}

/** On the Add pet page: the timeline needs a saved pet, because each update belongs to one. */
export function PetTimelineUnsaved() {
  return (
    <section aria-labelledby="pet-timeline-heading" className="mt-10">
      <Card>
        <CardHeader>
          <h2 id="pet-timeline-heading" className="text-base font-semibold">
            Timeline
          </h2>
          <CardDescription>Save the pet first. You can then post dated updates about them here.</CardDescription>
        </CardHeader>
      </Card>
    </section>
  );
}
