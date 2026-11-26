"use client";

import React from "react";

import { Button } from "@pet-adopt/ui/components/button";
import { Field, FieldLabel } from "@pet-adopt/ui/components/field";
import { Input } from "@pet-adopt/ui/components/input";
import { confirmTwoFactorSetupAction, startTwoFactorSetupAction, type TwoFactorSetup as Setup } from "@/server/actions/two-factor";

import { BackupCodeList } from "./BackupCodeList";

// Setting up two-factor sign-in, in three steps: your password, then save the backup codes (shown
// only once), then scan the QR code and type the code your app shows, which turns two-factor on.
// Turning it on is the last step on purpose: it replaces the session cookie, and Next then
// re-renders the page (the admin layout swaps the required-setup screen for the admin).

type Failure = { ok: false; error: string; fieldErrors?: Record<string, string> };

export function TwoFactorSetup({ siteName, onDone, onCancel }: { siteName: string; onDone: () => void; onCancel?: () => void }) {
  const [step, setStep] = React.useState<"password" | "codes" | "scan">("password");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [setup, setSetup] = React.useState<Setup | null>(null);
  const [error, setError] = React.useState<{ field?: string; message: string } | null>(null);
  const [pending, startTransition] = React.useTransition();
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  const fail = (result: Failure, field: string) => {
    const fieldError = result.fieldErrors?.[field];
    setError(fieldError ? { field, message: fieldError } : { message: result.error });
  };
  // Each step moves focus to its heading, so screen readers hear where they are.
  const go = (next: typeof step) => {
    setStep(next);
    setError(null);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  function start(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const result = await startTwoFactorSetupAction({ password });
      if (!result.ok) return fail(result, "password");
      setPassword("");
      setSetup(result.data);
      go("codes");
    });
  }

  function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const result = await confirmTwoFactorSetupAction({ code });
      if (!result.ok) return fail(result, "code");
      onDone();
    });
  }

  const errorFor = (field: string) => (error?.field === field ? error.message : undefined);
  const formError =
    error && !error.field ? (
      <p role="alert" className="text-sm text-destructive">
        {error.message}
      </p>
    ) : null;

  if (step === "password") {
    const message = errorFor("password");
    return (
      <form onSubmit={start} noValidate className="flex flex-col gap-4">
        <h3 ref={headingRef} tabIndex={-1} className="font-medium outline-none">
          Step 1 of 3: confirm it is you
        </h3>
        {formError}
        <Field data-invalid={message ? true : undefined}>
          <FieldLabel htmlFor="tf-password">Your password</FieldLabel>
          <Input
            id="tf-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? "tf-password-error" : undefined}
          />
          {message ? (
            <p id="tf-password-error" role="alert" className="text-sm text-destructive">
              {message}
            </p>
          ) : null}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" aria-disabled={pending || undefined}>
            {pending ? "Checking…" : "Continue"}
          </Button>
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    );
  }

  if (step === "scan" && setup) {
    const message = errorFor("code");
    return (
      <form onSubmit={confirm} noValidate className="flex flex-col gap-4">
        <h3 ref={headingRef} tabIndex={-1} className="font-medium outline-none">
          Step 3 of 3: add {siteName} to your authenticator app
        </h3>
        <p className="text-sm">
          Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden or another) and scan this code.
        </p>
        {/* A data URL drawn on the server. White behind it so it still scans in dark mode. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={setup.qrCode} alt="QR code to add this account to an authenticator app" width={200} height={200} className="rounded-md bg-white p-2" />
        <div className="text-sm">
          <p>Cannot scan it? Type this key into the app instead:</p>
          <p className="mt-1 font-mono text-base break-all select-all">{setup.manualKey}</p>
        </div>
        {formError}
        <Field data-invalid={message ? true : undefined}>
          <FieldLabel htmlFor="tf-code">The 6-digit code your app shows</FieldLabel>
          <Input
            id="tf-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            className="max-w-40 font-mono"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? "tf-code-error" : undefined}
          />
          {message ? (
            <p id="tf-code-error" role="alert" className="text-sm text-destructive">
              {message}
            </p>
          ) : null}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" aria-disabled={pending || undefined}>
            {pending ? "Checking…" : "Turn on two-factor"}
          </Button>
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 ref={headingRef} tabIndex={-1} className="font-medium outline-none">
        Step 2 of 3: save your backup codes
      </h3>
      <p className="text-sm">
        If you lose your phone, each of these codes signs you in once. Keep them somewhere safe, away from your phone. They are not shown again.
      </p>
      {setup ? <BackupCodeList codes={setup.backupCodes} siteName={siteName} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => go("scan")}>
          I have saved my codes
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
