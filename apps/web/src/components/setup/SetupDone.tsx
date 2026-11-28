"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";

import { Button } from "@pet-adopt/ui/components/button";
import { EmailConfirmBanner } from "@/components/admin/EmailConfirmBanner";
import { finishSetupAction } from "@/server/actions/setup";

// Setup's last step: what is ready, what is left, and where to go next. Finishing ends the setup.

export function SetupDone({
  storage,
  emailReady,
  needsConfirmation,
  email,
}: {
  /** From a test write to the bucket: where uploads go, and what failed (null when it worked). */
  storage: { description: string | null; problem: string | null };
  emailReady: boolean;
  needsConfirmation: boolean;
  email: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function finish() {
    if (pending) return;
    startTransition(async () => {
      const result = await finishSetupAction({});
      if (!result.ok) return setError(result.error);
      router.replace("/admin");
    });
  }

  const checks = [
    {
      ok: !storage.problem,
      label: storage.problem
        ? `Image storage does not work yet${storage.description ? ` (${storage.description})` : ""}: uploads will fail until the S3_* settings are right. ${storage.problem}`
        : `Image storage works (${storage.description}).`,
    },
    { ok: emailReady, label: emailReady ? "Email is set up." : "Email is not set up: no reset links, invites or form notifications until it is (Settings > Email)." },
  ];

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">You’re ready</h1>
        <p className="text-sm text-muted-foreground">Here is what is set up, and some good next steps.</p>
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {checks.map((check) => (
          <li key={check.label} className="flex gap-2">
            <span aria-hidden="true">{check.ok ? "✓" : "!"}</span>
            <span>
              <span className="sr-only">{check.ok ? "Done: " : "To do: "}</span>
              {check.label}
            </span>
          </li>
        ))}
      </ul>
      {needsConfirmation ? <EmailConfirmBanner email={email} /> : null}
      <div className="flex flex-col gap-2 text-sm">
        <h2 className="font-medium">Next steps</h2>
        <ul className="list-disc pl-5">
          <li>
            <Link href="/admin/pets/new" className="underline underline-offset-4">Add your first pet</Link>
          </li>
          <li>
            <Link href="/admin/users" className="underline underline-offset-4">Invite your team</Link>
          </li>
          <li>
            <Link href="/admin/account" className="underline underline-offset-4">Turn on two-factor sign-in</Link> for your account
          </li>
          <li>
            <Link href="/admin/settings" className="underline underline-offset-4">Finish your site settings</Link>: logo, address, opening hours, menu
          </li>
        </ul>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="button" onClick={finish} aria-disabled={pending || undefined}>
          {pending ? "Finishing…" : "Go to the admin"}
        </Button>
      </div>
    </section>
  );
}
