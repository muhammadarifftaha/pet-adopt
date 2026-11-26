"use client";

import { useRouter } from "next/navigation";
import React from "react";

import { finishSetupAction } from "@/server/actions/setup";

/** "Skip the rest of the setup": ends it for good (everything stays in the normal settings). */
export function SkipSetup() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function skip() {
    if (pending) return;
    startTransition(async () => {
      const result = await finishSetupAction({ skipped: true });
      if (!result.ok) return setError(result.error);
      router.replace("/admin");
    });
  }

  return (
    <div className="flex flex-col items-center gap-1 border-t pt-4 text-sm">
      <button type="button" onClick={skip} aria-disabled={pending || undefined} className="text-muted-foreground underline underline-offset-4">
        {pending ? "Skipping…" : "Skip the rest of the setup"}
      </button>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
