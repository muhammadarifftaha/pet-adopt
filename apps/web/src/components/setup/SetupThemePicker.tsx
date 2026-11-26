"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import React from "react";

import { Button } from "@pet-adopt/ui/components/button";
import { PRESETS, PRESET_KEYS, type PresetKey } from "@/lib/theme";
import { activateThemeAction } from "@/server/actions/themes";

// Setup step 3: one of the built-in looks. Colours, fonts and shapes can be changed on Theme later.

export function SetupThemePicker({ current }: { current: string }) {
  const router = useRouter();
  const [picked, setPicked] = React.useState<PresetKey>((PRESET_KEYS as string[]).includes(current) ? (current as PresetKey) : "sunrise");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function save() {
    if (pending) return;
    startTransition(async () => {
      const result = await activateThemeAction({ preset: picked });
      if (!result.ok) return setError(result.error);
      router.push("/setup?step=sample");
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Pick a look</h1>
        <p className="text-sm text-muted-foreground">You can change colours, fonts and shapes on Theme later.</p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <fieldset>
        <legend className="sr-only">Themes</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PRESET_KEYS.map((key) => {
            const preset = PRESETS[key];
            const light = preset.light as { primary: string; bg: string; ink: string; tint?: string };
            return (
              <label
                key={key}
                className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring ${picked === key ? "border-primary ring-2 ring-primary" : ""}`}
              >
                <input type="radio" name="theme" value={key} checked={picked === key} onChange={() => setPicked(key)} className="sr-only" />
                {/* A small preview in the theme's own light colours. */}
                <span aria-hidden="true" className="flex h-16 items-end gap-2 rounded-md border p-2" style={{ background: light.bg, color: light.ink }}>
                  <span className="text-sm font-bold">Aa</span>
                  <span className="ml-auto h-6 w-16 rounded" style={{ background: light.primary }} />
                </span>
                <span className="font-medium">{preset.label}</span>
                <span className="text-sm text-muted-foreground">{preset.description}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="flex justify-between gap-3">
        <Link href="/setup?step=sample" className="text-sm underline underline-offset-4">
          Skip this step
        </Link>
        <Button type="button" onClick={save} aria-disabled={pending || undefined}>
          {pending ? "Saving…" : "Use this look"}
        </Button>
      </div>
    </section>
  );
}
