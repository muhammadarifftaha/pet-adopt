"use client";

import React from "react";
import { FiCopy, FiSend } from "react-icons/fi";

import { Button } from "@pet-adopt/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@pet-adopt/ui/components/dialog";
import { Field, FieldLabel } from "@pet-adopt/ui/components/field";
import { Input } from "@pet-adopt/ui/components/input";
import { resendInviteAction } from "@/server/actions/users";
import type { InviteResult } from "@/server/invites";
import type { UserListItem } from "@/server/users";
import { useWhen } from "@/components/admin/site-time";

// Email invites on the Users screen (src/server/invites.ts): the result of an invite (emailed, or the
// link to copy when the site could not email it) and "Resend invite" for someone who has not
// accepted yet.

/** The outcome of an invite: "emailed to …", or the link with Copy when it was not emailed. */
export function InviteOutcome({ invite, user }: { invite: InviteResult; user: { name: string; email: string } }) {
  const when = useWhen();
  const [note, setNote] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const id = "invite-link";

  async function copy() {
    try {
      await navigator.clipboard.writeText(invite.url);
      setNote("Link copied.");
    } catch {
      inputRef.current?.select();
      setNote("Could not copy automatically: the link is selected, copy it with Ctrl+C (Cmd+C on a Mac).");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {invite.sent ? (
        <p role="status">
          An invite was emailed to {user.email}. {user.name} chooses a password with its link, which works once until{" "}
          {when(invite.expiresAt)}.
        </p>
      ) : (
        <p role="alert">
          {invite.problem ?? "The invite was not emailed."} Send {user.name} this link yourself; it works once until {when(invite.expiresAt)}.
        </p>
      )}
      {invite.sent ? null : (
        <Field>
          <FieldLabel htmlFor={id}>Invite link</FieldLabel>
          <div className="flex flex-wrap gap-2">
            <Input id={id} ref={inputRef} readOnly value={invite.url} className="min-w-0 flex-1 basis-56 font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button type="button" variant="outline" onClick={copy}>
              <FiCopy aria-hidden />
              Copy
              <span className="sr-only">link</span>
            </Button>
          </div>
          <p aria-live="polite" className="text-sm">
            {note}
          </p>
        </Field>
      )}
    </div>
  );
}

/** A new invite for someone who has not accepted yet (the old link stops working). */
export function ResendInviteDialog({ user, onDone }: { user: UserListItem; onDone: (message: string) => void }) {
  const when = useWhen();
  const [open, setOpen] = React.useState(false);
  const [invite, setInvite] = React.useState<InviteResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function change(next: boolean) {
    setOpen(next);
    if (!next) {
      if (invite) onDone(invite.sent ? `A new invite was emailed to ${user.name}.` : `A new invite link for ${user.name} was made.`);
      setInvite(null);
      setError(null);
    }
  }

  function send() {
    if (pending) return;
    startTransition(async () => {
      const result = await resendInviteAction(user.id);
      if (result.ok) {
        setInvite(result.data);
        setError(null);
      } else setError(result.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <FiSend aria-hidden />
        Resend invite
        <span className="sr-only">to {user.name}</span>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resend the invite to {user.name}?</DialogTitle>
          <DialogDescription>
            {!user.inviteActive ? "Their invite has expired or was never sent." : `Their invite works until ${when(user.inviteExpiresAt as Date)}.`} A
            new one works for 7 days, and the old link stops working.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {invite ? <InviteOutcome invite={invite} user={user} /> : null}
        <DialogFooter>
          {invite ? (
            <Button type="button" onClick={() => change(false)}>
              Done
            </Button>
          ) : (
            <Button type="button" aria-disabled={pending || undefined} onClick={send}>
              {pending ? "Sending…" : "Send a new invite"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
