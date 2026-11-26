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
export function ConfirmEmailForm({ token, name, email, isChange }: { token: string; name: string; email: string; isChange: boolean }) {
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
          <h2 className="text-lg font-semibold">{isChange ? "Email changed" : "Email confirmed"}</h2>
          <p role="status">{isChange ? `From now on, sign in with ${email}. Your password stays the same.` : "Thank you. You can make changes in the admin now."}</p>
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
        <h2 className="text-lg font-semibold">{isChange ? "Confirm your new email" : "Confirm your email"}</h2>
        <p>
          {isChange ? (
            <>
              {name}, confirm that you want to sign in with <strong className="break-all">{email}</strong> from now on.
            </>
          ) : (
            <>
              {name}, confirm that <strong className="break-all">{email}</strong> is your email address.
            </>
          )}
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
