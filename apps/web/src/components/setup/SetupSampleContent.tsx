"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import React from "react";

import { Button } from "@pet-adopt/ui/components/button";
import { addSampleContentAction, removeSampleContentAction } from "@/server/actions/setup";

// Setup step 4: example pets (with placeholder pictures) and an About page, so the site is not empty
// while you get going. They can be taken out again here, or deleted one by one later.

export function SetupSampleContent({ hasSample }: { hasSample: boolean }) {
  const router = useRouter();
  const [message, setMessage] = React.useState<{ text: string; isError: boolean } | null>(null);
  const [pending, startTransition] = React.useTransition();

  function add() {
    if (pending) return;
    startTransition(async () => {
      const result = await addSampleContentAction();
      if (!result.ok) return setMessage({ text: result.error, isError: true });
      router.push("/setup?step=email");
    });
  }

  function remove() {
    if (pending) return;
    startTransition(async () => {
      const result = await removeSampleContentAction();
      setMessage(result.ok ? { text: `Removed ${result.data.pets} example pets.`, isError: false } : { text: result.error, isError: true });
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Sample content</h1>
        <p className="text-sm text-muted-foreground">
          Add a few example pets with placeholder pictures and an About page, to see how the site looks before your own pets are in. You can take them out
          again later.
        </p>
      </div>
      {message ? (
        <p role={message.isError ? "alert" : "status"} className={`text-sm ${message.isError ? "text-destructive" : ""}`}>
          {message.text}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/setup?step=email" className="text-sm underline underline-offset-4">
          {hasSample ? "Continue" : "Skip this step"}
        </Link>
        <span className="flex flex-wrap gap-2">
          {hasSample ? (
            <Button type="button" variant="outline" onClick={remove} aria-disabled={pending || undefined}>
              Remove sample content
            </Button>
          ) : null}
          <Button type="button" onClick={add} aria-disabled={pending || undefined}>
            {pending ? "Working…" : hasSample ? "Add any that are missing" : "Add sample content"}
          </Button>
        </span>
      </div>
    </section>
  );
}
