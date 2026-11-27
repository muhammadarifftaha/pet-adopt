"use client";

import { useRouter } from "next/navigation";
import React from "react";
import useSWR from "swr";
import { FiChevronLeft, FiChevronRight, FiExternalLink } from "react-icons/fi";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@pet-adopt/ui/components/alert-dialog";
import { Badge } from "@pet-adopt/ui/components/badge";
import { Button } from "@pet-adopt/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@pet-adopt/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@pet-adopt/ui/components/dialog";
import { Skeleton } from "@pet-adopt/ui/components/skeleton";
import { useViewOnly } from "@/components/admin/view-only";
import { unwrapResult } from "@/lib/admin/unwrap-client";
import { listPageVersionsAction, restoreAndPublishPageVersionAction, restorePageVersionAction } from "@/server/actions/pages";
import type { PageVersionSummary } from "@/server/types";
import { useWhen } from "@/components/admin/site-time";

// The page's saved versions, in the page settings sidebar under Publishing. Open one to see it,
// step to older or newer ones, and restore it. A restore never rewrites history: the old layout
// comes back as a NEW version (on version 3, restoring version 2 makes version 4, and version 3
// stays). "Restore" puts it in the draft; "Restore and publish" also makes it live, for a quick
// rollback. View-only roles can look through versions but not restore.


type Props = {
  pageId: number;
  pageTitle: string;
  /** The page's last change; every restore sends it, so a stale screen cannot overwrite newer work. */
  updatedAt: Date;
  /** Published and not archived: one version is live. */
  live: boolean;
  archived: boolean;
};

export function PageVersions({ pageId, pageTitle, updatedAt, live, archived }: Props) {
  const when = useWhen();
  const viewOnly = useViewOnly();
  const router = useRouter();
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);
  const [message, setMessage] = React.useState<{ text: string; id: number } | null>(null);
  const messageRef = React.useRef<HTMLParagraphElement>(null);

  // Keyed on the page's last change: a save or restore elsewhere changes the list.
  const { data: versions, error } = useSWR(["page-versions", pageId, updatedAt.getTime()], () =>
    listPageVersionsAction(pageId).then(unwrapResult),
  );

  // Newest first: the first one holds the current draft; the newest published one is live.
  const draftNumber = versions?.[0]?.number ?? null;
  const liveNumber = live ? (versions?.find((v) => v.kind === "published")?.number ?? null) : null;

  const done = (text: string) => {
    setOpenIndex(null);
    setMessage((previous) => ({ text, id: (previous?.id ?? 0) + 1 }));
    router.refresh();
    // The dialog's trigger is in the list, which reloads: focus the message that says what happened.
    requestAnimationFrame(() => messageRef.current?.focus());
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>
          <h2 id="page-versions-heading" className="text-base">
            Versions
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          Every publish is a version. Open one to see it{viewOnly || archived ? "." : " or bring it back; a restore is saved as a new version, so nothing is lost."}
        </p>
        <p ref={messageRef} tabIndex={-1} role="status" aria-live="polite" className="outline-none">
          {message?.text ?? ""}
        </p>
        {error ? (
          <p role="alert" className="text-destructive">
            The versions could not be loaded.
          </p>
        ) : !versions ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : versions.length === 0 ? (
          <p className="text-muted-foreground">No versions yet. Open the page builder and save to make the first one.</p>
        ) : (
          <ol aria-labelledby="page-versions-heading" className="flex max-h-96 flex-col divide-y overflow-y-auto rounded-md border">
            {versions.map((v, index) => (
              <li key={v.number} className="flex items-center justify-between gap-2 p-2">
                <span className="flex min-w-0 flex-col">
                  <span className="flex flex-wrap items-center gap-1.5 font-medium">
                    Version {v.number}
                    <VersionBadges number={v.number} draftNumber={draftNumber} liveNumber={liveNumber} />
                  </span>
                  <span className="text-xs text-muted-foreground">{describe(v, when)}</span>
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => setOpenIndex(index)}>
                  View
                  <span className="sr-only">version {v.number}</span>
                </Button>
              </li>
            ))}
          </ol>
        )}
      </CardContent>

      {versions && openIndex !== null && versions[openIndex] ? (
        <VersionDialog
          pageId={pageId}
          pageTitle={pageTitle}
          updatedAt={updatedAt}
          versions={versions}
          index={openIndex}
          onIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          draftNumber={draftNumber}
          liveNumber={liveNumber}
          canRestore={!viewOnly && !archived}
          onDone={done}
        />
      ) : null}
    </Card>
  );
}

function VersionBadges({ number, draftNumber, liveNumber }: { number: number; draftNumber: number | null; liveNumber: number | null }) {
  return (
    <>
      {number === liveNumber ? <Badge>Live</Badge> : null}
      {number === draftNumber && number !== liveNumber ? <Badge variant="secondary">Current draft</Badge> : null}
    </>
  );
}

/** "Published, 3 Dec 2026, 10:04 by Siti" / "Restored from version 2, ...". */
function describe(v: PageVersionSummary, when: (value: Date | string) => string) {
  const what = v.restoredFrom ? `Restored from version ${v.restoredFrom}` : v.kind === "published" ? "Published" : "Not published";
  return `${what}, ${when(v.updatedAt)}${v.createdBy ? ` by ${v.createdBy}` : ""}`;
}

function VersionDialog({
  pageId,
  pageTitle,
  updatedAt,
  versions,
  index,
  onIndex,
  onClose,
  draftNumber,
  liveNumber,
  canRestore,
  onDone,
}: {
  pageId: number;
  pageTitle: string;
  updatedAt: Date;
  versions: PageVersionSummary[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  draftNumber: number | null;
  liveNumber: number | null;
  canRestore: boolean;
  onDone: (message: string) => void;
}) {
  const when = useWhen();
  const version = versions[index];
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const previewUrl = `/edit/${pageId}/preview?version=${version.number}`;
  const isDraft = version.number === draftNumber;
  // Newest first: "Newer" goes up the list, "Older" down.
  const newer = index > 0 ? index - 1 : null;
  const older = index < versions.length - 1 ? index + 1 : null;

  const go = (next: number | null) => {
    if (next === null) return;
    setError(null);
    onIndex(next);
  };

  const restore = (publish: boolean) => {
    if (pending) return;
    startTransition(async () => {
      const action = publish ? restoreAndPublishPageVersionAction : restorePageVersionAction;
      const result = await action(pageId, version.number, updatedAt.getTime());
      if (!result.ok) {
        setConfirmOpen(false);
        setError(result.error);
        return;
      }
      onDone(
        publish
          ? `Version ${version.number} is live again, saved as version ${result.data.number}.`
          : `Version ${version.number} is now the draft, saved as version ${result.data.number}. Publish to make it live.`,
      );
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Version {version.number} of “{pageTitle}”
            <VersionBadges number={version.number} draftNumber={draftNumber} liveNumber={liveNumber} />
          </DialogTitle>
          <DialogDescription>{describe(version, when)}.</DialogDescription>
        </DialogHeader>

        {/* Click through the history without closing the dialog. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" aria-disabled={newer === null || undefined} onClick={() => go(newer)}>
            <FiChevronLeft aria-hidden />
            Newer
          </Button>
          <Button type="button" variant="outline" size="sm" aria-disabled={older === null || undefined} onClick={() => go(older)}>
            Older
            <FiChevronRight aria-hidden />
          </Button>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {index + 1} of {versions.length}
          </span>
          <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline">
            Open in a new tab
            <FiExternalLink aria-hidden />
            <span className="sr-only">(version {version.number})</span>
          </a>
        </div>

        {/* The version as visitors would see it, in the site's own styles. Sandboxed: no scripts. */}
        <iframe
          key={version.number}
          src={previewUrl}
          title={`Preview of version ${version.number}`}
          sandbox="allow-same-origin"
          className="h-[55dvh] w-full rounded-md border"
        />

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {canRestore ? (
          <DialogFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            {isDraft ? (
              <p className="mr-auto text-sm text-muted-foreground">This is the current draft.</p>
            ) : (
              <>
                <p className="mr-auto text-sm text-muted-foreground">
                  Restoring saves it as a new version. Your current draft stays in the history.
                </p>
                <Button type="button" variant="outline" aria-disabled={pending || undefined} onClick={() => restore(false)}>
                  {pending ? "Restoring…" : "Restore as draft"}
                </Button>
                <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                  <AlertDialogTrigger render={<Button type="button" aria-disabled={pending || undefined} />}>Restore and publish</AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Make version {version.number} live now?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Visitors see it straight away. It is saved as a new version; the current draft{liveNumber ? " and the version that was live" : ""} stay in the
                        history.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Not yet</AlertDialogCancel>
                      <Button aria-disabled={pending || undefined} onClick={() => restore(true)}>
                        {pending ? "Publishing…" : "Restore and publish"}
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
