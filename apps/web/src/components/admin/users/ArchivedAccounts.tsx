"use client";

import { useRouter } from "next/navigation";
import React from "react";
import { FiRotateCcw, FiTrash2 } from "react-icons/fi";

import { ROLE_INFO } from "@pet-adopt/plugin-sdk";
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
import { useViewOnly } from "@/components/admin/view-only";
import { deleteUserAction, restoreUserAction } from "@/server/actions/users";
import type { UserListItem } from "@/server/users";

// Authentication > Archived accounts: accounts that cannot sign in, with Restore (back as they
// were) and Delete (for good). Accounts are archived from the Users screen. Results go to one
// status line: polite for success, an alert for failures.

const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

type Announce = (message: string, isError?: boolean) => void;

export function ArchivedAccounts({ users }: { users: UserListItem[] }) {
  const router = useRouter();
  const viewOnly = useViewOnly();
  const [message, setMessage] = React.useState<{ text: string; isError: boolean; id: number } | null>(null);
  const messageRef = React.useRef<HTMLDivElement>(null);
  const announce = React.useCallback<Announce>(
    (text, isError = false) => setMessage((previous) => ({ text, isError, id: (previous?.id ?? 0) + 1 })),
    [],
  );
  // The row leaves this list either way: say so, and give focus somewhere to go.
  const done = (text: string) => {
    announce(text);
    router.refresh();
    requestAnimationFrame(() => messageRef.current?.focus());
  };

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Archived accounts cannot sign in. Their names stay on what they made and in the activity log. Restore brings an account back as it was: same
        role, password and two-factor. Accounts are archived from the Users screen.
      </p>
      <div ref={messageRef} tabIndex={-1} aria-live="polite" className="min-h-6 text-sm outline-none">
        {message && !message.isError ? <p key={message.id}>{message.text}</p> : null}
      </div>
      {message?.isError ? (
        <p key={message.id} role="alert" className="text-sm text-destructive">
          {message.text}
        </p>
      ) : null}
      {users.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No archived accounts.</p>
      ) : (
        <ul aria-label="Archived accounts" className="flex flex-col divide-y rounded-lg border">
          {users.map((user) => (
            <li key={user.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
              <span className="flex min-w-0 flex-1 basis-64 flex-col">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{user.name}</span>
                  <Badge variant="outline">{ROLE_INFO[user.role].label}</Badge>
                </span>
                <span className="text-sm break-all text-muted-foreground">
                  {user.email} · archived {when.format(new Date(user.archivedAt as Date))}
                </span>
              </span>
              {viewOnly ? null : (
                <span className="flex flex-wrap gap-2">
                  <RestoreUser user={user} announce={announce} onDone={done} />
                  <DeleteUser user={user} announce={announce} onDeleted={done} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Brings an archived account back as it was. */
function RestoreUser({ user, announce, onDone }: { user: UserListItem; announce: Announce; onDone: (message: string) => void }) {
  const [pending, startTransition] = React.useTransition();

  function restore() {
    if (pending) return;
    startTransition(async () => {
      const result = await restoreUserAction(user.id);
      if (result.ok) onDone(`${user.name} was restored and can sign in again.`);
      else announce(result.error, true);
    });
  }

  return (
    <Button variant="outline" size="sm" aria-disabled={pending || undefined} onClick={restore}>
      <FiRotateCcw aria-hidden />
      {pending ? "Restoring…" : "Restore"}
      <span className="sr-only">{user.name}</span>
    </Button>
  );
}

/** Deletes an archived account for good. */
function DeleteUser({ user, announce, onDeleted }: { user: UserListItem; announce: Announce; onDeleted: (message: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function remove() {
    if (pending) return;
    startTransition(async () => {
      const result = await deleteUserAction(user.id);
      setOpen(false);
      if (result.ok) onDeleted(`${user.name} was deleted.`);
      else announce(result.error, true);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {/* The dialog's own trigger, so closing it ("Keep", Escape) returns focus here. */}
      <AlertDialogTrigger render={<Button variant="destructive" size="sm" aria-disabled={pending || undefined} />}>
        <FiTrash2 aria-hidden />
        Delete
        <span className="sr-only">{user.name}</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {user.name} for good?</AlertDialogTitle>
          <AlertDialogDescription>
            The account cannot be restored after this. The activity log keeps their name; page versions and email templates they made will show no
            creator. Pets, pages and images stay.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep</AlertDialogCancel>
          <Button variant="destructive" aria-disabled={pending || undefined} onClick={remove}>
            {pending ? "Deleting…" : "Delete account"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
