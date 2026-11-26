"use client";

import { useRouter } from "next/navigation";
import React from "react";
import { FiTrash2 } from "react-icons/fi";

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
import { Button } from "@pet-adopt/ui/components/button";
import { Card, CardContent, CardHeader } from "@pet-adopt/ui/components/card";
import { Field, FieldLabel } from "@pet-adopt/ui/components/field";
import { Input } from "@pet-adopt/ui/components/input";
import { requestAccountDeletionAction } from "@/server/actions/auth";
import type { SessionUser } from "@/server/types";

// Delete your own account (src/server/users.ts, requestOwnDeletion): closed at once, deleted for good
// after the grace period, when your name also leaves the activity log. An admin can restore it until
// then. Asks for the password in a confirmation dialog.

export function DeleteAccountCard({ user, graceDays, lastAdmin }: { user: SessionUser; graceDays: number; lastAdmin: boolean }) {
  const router = useRouter();
  const [blockedNote, setBlockedNote] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();

  function change(next: boolean) {
    setOpen(next);
    if (!next) {
      setPassword("");
      setError(undefined);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const result = await requestAccountDeletionAction({ password });
      if (!result.ok) return setError(result.fieldErrors?.password ?? result.error);
      // Signed out everywhere already: the sign-in page explains what happens next (a different
      // root layout, so a full page load).
      router.replace("/admin/login?closed=1");
    });
  }

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <h2 className="text-base font-semibold">Delete account</h2>
        <p className="text-sm text-muted-foreground">
          Your account is closed at once and deleted for good after {graceDays} days. Until then an admin can restore it. After that, your name, picture and
          sign-in details are gone, and the activity log shows what you did as “Deleted user” only. Pets, pages and images you made stay.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {lastAdmin ? (
          // Said before anything is asked: the server refuses it anyway (src/server/users.ts).
          <>
            <p className="rounded-md border border-destructive/50 bg-muted p-3 text-sm">
              You are the only admin, so your account cannot be deleted: someone must be able to manage the site. Make another person an admin on the Users
              screen first.
            </p>
            <div>
              <Button variant="destructive" aria-disabled className="cursor-not-allowed opacity-50" aria-describedby="delete-account-blocked" onClick={() => setBlockedNote(true)}>
                <FiTrash2 aria-hidden />
                Delete my account
                <span className="sr-only">: not possible, you are the only admin</span>
              </Button>
            </div>
            <p id="delete-account-blocked" role="status" className="text-sm empty:hidden">
              {blockedNote ? "Not possible while you are the only admin." : ""}
            </p>
          </>
        ) : (
          <AlertDialog open={open} onOpenChange={change}>
            <AlertDialogTrigger render={<Button variant="destructive" />}>
              <FiTrash2 aria-hidden />
              Delete my account
            </AlertDialogTrigger>
            <AlertDialogContent>
              <form onSubmit={submit} noValidate className="flex flex-col gap-4">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    You are signed out everywhere and cannot sign in again. {user.email} is deleted for good in {graceDays} days unless an admin restores it.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {/* For password managers: which account the password belongs to. */}
                <input type="email" name="username" autoComplete="username" value={user.email} readOnly hidden />
                <Field data-invalid={error ? true : undefined}>
                  <FieldLabel htmlFor="delete-account-password">Your password</FieldLabel>
                  <Input
                    id="delete-account-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "delete-account-password-error" : undefined}
                  />
                  {error ? (
                    <p id="delete-account-password-error" role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  ) : null}
                </Field>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep my account</AlertDialogCancel>
                  <Button type="submit" variant="destructive" aria-disabled={pending || undefined}>
                    {pending ? "Deleting…" : "Delete my account"}
                  </Button>
                </AlertDialogFooter>
              </form>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardContent>
    </Card>
  );
}
