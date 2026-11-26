"use client";
import React from "react";
import Link from "next/link";

import { Button, buttonVariants } from "@pet-adopt/ui/components/button";
import { Card, CardFooter, CardHeader } from "@pet-adopt/ui/components/card";
import { confirmEmailChangeAction } from "@/server/actions/email-change";

/**
 * /admin/confirm-email: one button that makes the new address the one this account signs in with.
 * A button, not the link itself: mail scanners open links in emails, and must not confirm anything.
 */
export function ConfirmEmailForm({ token, name, email }: { token: string; name: string; email: string }) {
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function confirm() {
    if (pending) return;
    startTransition(async () => {
      const result = await confirmEmailChangeAction({ token });
      if (result.ok) setDone(true);
      else setError(result.error);
    });
  }

  if (done) {
    return (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <h2 className="text-lg font-semibold">Email changed</h2>
          <p role="status">From now on, sign in with {email}. Your password stays the same.</p>
        </CardHeader>
        <CardFooter className="justify-end">
          <Link href="/admin/account" className={buttonVariants()}>
            Go to your account
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <h2 className="text-lg font-semibold">Confirm your new email</h2>
        <p>
          {name}, confirm that you want to sign in with <strong className="break-all">{email}</strong> from now on.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardHeader>
      <CardFooter className="justify-end">
        <Button type="button" onClick={confirm} aria-disabled={pending || undefined}>
          {pending ? "Confirming…" : "Confirm"}
        </Button>
      </CardFooter>
    </Card>
  );
}
