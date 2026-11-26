"use client";

import { useRouter } from "next/navigation";
import React from "react";
import { FiShieldOff, FiTrash2 } from "react-icons/fi";

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
import { Avatar, AvatarFallback } from "@pet-adopt/ui/components/avatar";
import { Badge } from "@pet-adopt/ui/components/badge";
import { Button } from "@pet-adopt/ui/components/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@pet-adopt/ui/components/table";
import { initialsOf } from "@/lib/admin/initials";
import { useViewOnly } from "@/components/admin/view-only";
import { ROLE_INFO, ROLES } from "@pet-adopt/plugin-sdk";
import { deleteUserAction } from "@/server/actions/users";
import { resetUserTwoFactorAction } from "@/server/actions/two-factor";
import type { UserListItem } from "@/server/users";

import { AddUserDialog, EditUserDialog, PasswordDialog, ResetLinkDialog } from "./UserDialogs";

// The admin list of accounts. Every rule (the last admin stays, roles, password length) is
// enforced on the server; the screen shows its messages and warns before you lock yourself out.
// Results go to one status line: polite for success, an alert for failures.

const added = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

type Announce = (message: string, isError?: boolean) => void;

export function UsersTable({ users, meId, minPasswordLength }: { users: UserListItem[]; meId: string; minPasswordLength: number }) {
  const router = useRouter();
  // `id` changes with every message, so the same text twice is announced twice.
  const [message, setMessage] = React.useState<{ text: string; isError: boolean; id: number } | null>(null);
  const messageRef = React.useRef<HTMLDivElement>(null);
  const announce = React.useCallback<Announce>(
    (text, isError = false) => setMessage((previous) => ({ text, isError, id: (previous?.id ?? 0) + 1 })),
    [],
  );
  const done = React.useCallback(
    (text: string) => {
      announce(text);
      router.refresh();
    },
    [announce, router],
  );
  const admins = users.filter((user) => user.role === "admin").length;
  // View-only roles (audit) see who has access; adding, editing and deleting are for admins.
  const viewOnly = useViewOnly();
  // "1 admin, 2 editors, 1 audit": only the roles someone has, in the usual order.
  const roleCounts = ROLES.map((role) => [role, users.filter((user) => user.role === role).length] as const)
    .filter(([, n]) => n > 0)
    .map(([role, n]) => `${n} ${ROLE_INFO[role].label.toLowerCase()}${n === 1 || role === "audit" ? "" : "s"}`)
    .join(", ");
  const deleted = (text: string) => {
    done(text);
    // The row is gone: focus the message that says so.
    requestAnimationFrame(() => messageRef.current?.focus());
  };
  const actions = (user: UserListItem) => {
    const isMe = user.id === meId;
    return (
      <>
        <EditUserDialog user={user} isMe={isMe} onDone={done} />
        <ResetLinkDialog user={user} onDone={(text) => announce(text)} />
        <PasswordDialog user={user} isMe={isMe} minPasswordLength={minPasswordLength} onDone={done} />
        {user.twoFactorEnabled && !isMe ? <ResetTwoFactor user={user} announce={announce} onDone={done} /> : null}
        <DeleteUser user={user} isMe={isMe} isLastAdmin={user.role === "admin" && admins <= 1} announce={announce} onDeleted={deleted} />
      </>
    );
  };
  const badges = (user: UserListItem) => (
    <>
      {user.id === meId ? <Badge variant="outline">You</Badge> : null}
      {user.banned ? <Badge variant="destructive">Banned</Badge> : null}
      {user.twoFactorEnabled ? (
        <Badge variant="secondary" title="Two-factor sign-in is on">
          2FA<span className="sr-only"> (two-factor sign-in on)</span>
        </Badge>
      ) : null}
    </>
  );
  // Initials, as in the header's user menu (accounts have no pictures yet). Hidden from screen
  // readers: the name beside it says the same.
  const avatar = (user: UserListItem) => (
    <Avatar aria-hidden="true">
      <AvatarFallback>{initialsOf(user.name, user.email)}</AvatarFallback>
    </Avatar>
  );
  const roleBadge = (user: UserListItem) => (
    <Badge variant={user.role === "admin" ? "default" : user.role === "audit" ? "outline" : "secondary"}>{ROLE_INFO[user.role].label}</Badge>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto text-sm text-muted-foreground">
          {users.length} {users.length === 1 ? "account" : "accounts"}: {roleCounts}
        </p>
        {viewOnly ? null : <AddUserDialog minPasswordLength={minPasswordLength} onDone={done} />}
      </div>

      {/* Results of actions. Focusable (tabIndex -1) so focus has somewhere to go when the focused
          row is deleted. */}
      <div ref={messageRef} tabIndex={-1} aria-live="polite" className="min-h-6 text-sm outline-none">
        {message && !message.isError ? <p key={message.id}>{message.text}</p> : null}
      </div>
      {message?.isError ? (
        <p key={message.id} role="alert" className="text-sm text-destructive">
          {message.text}
        </p>
      ) : null}

      {/* Phones: one card per account, with its buttons underneath (a table would hide them
          off-screen). From sm up: the table. Only one is displayed, so assistive tech gets one. */}
      <ul className="flex flex-col gap-3 sm:hidden" aria-label="Accounts">
        {users.map((user) => (
          <li key={user.id} className="flex flex-col gap-2 rounded-lg border p-3">
            <span className="flex flex-wrap items-center gap-2">
              {avatar(user)}
              <span className="font-medium">{user.name}</span>
              {roleBadge(user)}
              {badges(user)}
            </span>
            <span className="text-sm break-all">{user.email}</span>
            <span className="text-sm text-muted-foreground">Added {added.format(new Date(user.createdAt))}</span>
            {viewOnly ? null : <span className="flex flex-wrap gap-2 pt-1">{actions(user)}</span>}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-lg border sm:block">
        <Table>
          <caption className="sr-only">Accounts that can sign in to the admin, oldest first.</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Added</TableHead>
              {viewOnly ? null : (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-2">
                      {avatar(user)}
                      <span className="font-medium">{user.name}</span>
                      {badges(user)}
                    </span>
                  </TableCell>
                  <TableCell className="break-all">{user.email}</TableCell>
                  <TableCell>{roleBadge(user)}</TableCell>
                  <TableCell className="whitespace-nowrap">{added.format(new Date(user.createdAt))}</TableCell>
                  {viewOnly ? null : (
                    <TableCell>
                      <span className="flex flex-wrap items-center justify-end gap-2">{actions(user)}</span>
                    </TableCell>
                  )}
                </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DeleteUser({
  user,
  isMe,
  isLastAdmin,
  announce,
  onDeleted,
}: {
  user: UserListItem;
  isMe: boolean;
  isLastAdmin: boolean;
  announce: Announce;
  onDeleted: (message: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  // The last admin cannot be deleted (the server refuses too). The button stays reachable and says why.
  if (isLastAdmin) {
    return (
      <Button variant="destructive" size="sm" aria-disabled className="cursor-not-allowed opacity-50" onClick={() => announce("The last admin account cannot be deleted. Make someone else an admin first.", true)}>
        <FiTrash2 aria-hidden />
        Delete
        <span className="sr-only">{user.name}: not possible, this is the last admin</span>
      </Button>
    );
  }

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
          <AlertDialogTitle>{isMe ? "Delete your own account?" : `Delete ${user.name}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {isMe
              ? "You will be signed out at once and cannot sign in again. Pets, pages and images you made stay. This cannot be undone."
              : `${user.email} can no longer sign in, and is signed out everywhere. Pets, pages and images they made stay. This cannot be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep</AlertDialogCancel>
          <Button variant="destructive" aria-disabled={pending || undefined} onClick={remove}>
            {pending ? "Deleting…" : isMe ? "Delete my account" : "Delete account"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Turns off someone's two-factor sign-in, for when they lost their phone and backup codes. */
function ResetTwoFactor({ user, announce, onDone }: { user: UserListItem; announce: Announce; onDone: (message: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function reset() {
    if (pending) return;
    startTransition(async () => {
      const result = await resetUserTwoFactorAction(user.id);
      setOpen(false);
      if (result.ok) onDone(`Two-factor sign-in is off for ${user.name}.`);
      else announce(result.error, true);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" aria-disabled={pending || undefined} />}>
        <FiShieldOff aria-hidden />
        Turn off 2FA
        <span className="sr-only">for {user.name}</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Turn off two-factor sign-in for {user.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            For when they lost their phone and their backup codes. Their password alone will sign them in, and their backup codes and trusted browsers stop
            working. If their role must use two-factor, they set it up again at their next visit. Check it really is them asking first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it on</AlertDialogCancel>
          <Button variant="destructive" aria-disabled={pending || undefined} onClick={reset}>
            {pending ? "Turning off…" : "Turn off two-factor"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
