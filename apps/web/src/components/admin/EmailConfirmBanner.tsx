"use client";

import React from "react";

import { Button } from "@pet-adopt/ui/components/button";
import { requestEmailVerificationAction } from "@/server/actions/email-change";

/**
 * Shown across the admin (the (admin) layout) to someone who has not confirmed their email while the
 * site can send email: they can look around, but every change is refused until they confirm
 * (requirePermission, src/server/email-change.ts).
 */
export function EmailConfirmBanner({ email }: { email: string }) {
  const [message, setMessage] = React.useState<{ text: string; isError: boolean } | null>(null);
  const [pending, startTransition] = React.useTransition();

  function send() {
    if (pending) return;
    startTransition(async () => {
      const result = await requestEmailVerificationAction();
      setMessage(result.ok ? { text: `A link was sent to ${result.data.email}. Open it and press Confirm.`, isError: false } : { text: result.error, isError: true });
    });
  }

  return (
    <div role="region" aria-label="Confirm your email" className="flex flex-wrap items-center gap-3 border-b bg-muted px-4 py-2 text-sm">
      <p className="mr-auto">
        <strong>Confirm your email to make changes.</strong> You can look around, but saving anything waits until you confirm{" "}
        <span className="break-all">{email}</span>.
      </p>
      {/* Both stay in the page while empty (out of sight, not display:none), so screen readers
          notice when text arrives. */}
      <p role="status" className="text-sm empty:sr-only">
        {message && !message.isError ? message.text : ""}
      </p>
      <p role="alert" className="text-sm text-destructive empty:sr-only">
        {message?.isError ? message.text : ""}
      </p>
      <Button type="button" size="sm" onClick={send} aria-disabled={pending || undefined}>
        {pending ? "Sending…" : "Send confirmation link"}
      </Button>
    </div>
  );
}
