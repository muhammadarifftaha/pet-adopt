"use client";

import { useRouter } from "next/navigation";
import React from "react";
import useSWR from "swr";
import { FiExternalLink, FiMoon, FiRotateCcw, FiSun } from "react-icons/fi";

import { Badge } from "@pet-adopt/ui/components/badge";
import { Button } from "@pet-adopt/ui/components/button";
import { Skeleton } from "@pet-adopt/ui/components/skeleton";
import { unwrapResult } from "@/lib/admin/unwrap-client";
import { listPageVersionsAction, restorePageVersionAction } from "@/server/actions/pages";
import type { PageListItem } from "@/server/pages";
import type { PageVersionKind } from "@/server/types";

// The opened row of the pages table: a scaled-down preview of the page (an iframe of
// /edit/<id>/preview, in the site's own styles) and the page's saved versions. A version can be
// previewed in a new tab or copied back into the draft; the live page changes only on Publish.

// A version is one publish cycle: the open one collects draft saves until the next publish.
const KIND_LABEL: Record<PageVersionKind, string> = {
  draft: "Not published yet",
  published: "Published",
};

const formatWhen = (date: Date) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);

export function PageDetails({
  page,
  onMessage,
  darkMode = false,
}: {
  page: PageListItem;
  onMessage: (message: string, isError?: boolean) => void;
  /** The site has a dark theme (its light/dark toggle is on), so offer a dark preview. */
  darkMode?: boolean;
}) {
  const router = useRouter();
  // Bumped after a restore so the preview reloads with the new draft.
  const [previewKey, setPreviewKey] = React.useState(0);
  const [restoring, setRestoring] = React.useState<number | null>(null);
  const [mode, setMode] = React.useState<"light" | "dark">("light");
  const archived = page.state === "archived";

  // Keyed on the page's last change: a draft save updates the open version without a new number.
  const versions = useSWR(["page-versions", page.id, page.updatedAt.getTime()], () =>
    listPageVersionsAction(page.id).then(unwrapResult),
  );

  const restore = async (number: number) => {
    if (restoring !== null) return;
    setRestoring(number);
    try {
      const result = await restorePageVersionAction(page.id, number, page.updatedAt.getTime());
      if (!result.ok) {
        onMessage(result.error, true);
        return;
      }
      onMessage(
        `Version ${number} of “${page.title}” is now the draft, in version ${result.data.number}. Publish it to make it live.`,
      );
      setPreviewKey((k) => k + 1);
      await versions.mutate();
      router.refresh();
    } finally {
      setRestoring(null);
    }
  };

  const previewUrl = `/edit/${page.id}/preview`;
  // Every preview link follows the chosen mode.
  const withMode = (url: string) => (mode === "dark" ? `${url}${url.includes("?") ? "&" : "?"}mode=dark` : url);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section aria-labelledby={`preview-heading-${page.id}`} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 id={`preview-heading-${page.id}`} className="text-sm font-semibold">
            Preview {archived ? "(archived)" : "(latest draft)"}
          </h2>
          {darkMode ? (
            // Two toggle buttons: aria-pressed says which mode is showing.
            <div role="group" aria-label="Preview colours" className="flex items-center gap-1 rounded-md border p-0.5">
              {(["light", "dark"] as const).map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="xs"
                  variant={mode === value ? "secondary" : "ghost"}
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                >
                  {value === "light" ? <FiSun aria-hidden /> : <FiMoon aria-hidden />}
                  {value === "light" ? "Light" : "Dark"}
                </Button>
              ))}
            </div>
          ) : null}
          <a
            href={withMode(previewUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-6 items-center gap-1 text-sm underline-offset-4 hover:underline"
          >
            Open full size
            <FiExternalLink aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>
        {/* A desktop-width page drawn at 40%. Not interactive: use "Open full size" for that.
            sandbox without allow-scripts: the preview is server-rendered and needs no JavaScript. */}
        {/* aria-hidden: a small picture of the page; the same page is reachable with "Open full size",
            so screen readers skip it rather than wander into a scaled-down document. */}
        <div aria-hidden="true" className="relative h-80 w-full overflow-hidden rounded-md border bg-background">
          <iframe
            key={`${previewKey}-${mode}`}
            src={withMode(previewUrl)}
            title={`Preview of ${page.title}${mode === "dark" ? ", dark colours" : ""}`}
            loading="lazy"
            sandbox="allow-same-origin"
            tabIndex={-1}
            className="pointer-events-none absolute top-0 left-0 h-[250%] w-[250%] origin-top-left scale-[0.4] border-0"
          />
        </div>
      </section>

      <section aria-labelledby={`versions-heading-${page.id}`} className="flex min-w-0 flex-col gap-2">
        <h2 id={`versions-heading-${page.id}`} className="text-sm font-semibold">
          Versions
        </h2>
        {archived ? (
          <p className="text-xs text-muted-foreground">Restore the page to bring back an older version.</p>
        ) : null}
        {versions.error ? (
          <p role="alert" className="text-sm text-destructive">
            Could not load the versions: {String(versions.error.message ?? versions.error)}
          </p>
        ) : !versions.data ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <span className="sr-only">Loading versions</span>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : versions.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No versions yet. A version starts with the first saved draft and ends when it is published.
          </p>
        ) : (
          <ol className="flex max-h-80 flex-col divide-y overflow-y-auto rounded-md border bg-background">
            {versions.data.map((v, index) => (
              <li key={v.number} className="flex flex-wrap items-center justify-between gap-2 p-2">
                <div className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    Version {v.number}
                    <Badge variant={v.kind === "published" ? "default" : "outline"}>{KIND_LABEL[v.kind]}</Badge>
                    {index === 0 ? <span className="text-xs text-muted-foreground">Latest</span> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {v.kind === "published" ? "Published " : "Last saved "}
                    {formatWhen(new Date(v.updatedAt))}
                    {v.createdBy ? ` · ${v.createdBy}` : ""}
                    {v.restoredFrom ? ` · from version ${v.restoredFrom}` : ""}
                  </span>
                </div>
                <span className="flex items-center gap-1">
                  <a
                    href={withMode(`${previewUrl}?version=${v.number}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-6 items-center gap-1 px-2 text-sm underline-offset-4 hover:underline"
                  >
                    View
                    <span className="sr-only">version {v.number} (opens in a new tab)</span>
                  </a>
                  {!archived && index > 0 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-disabled={restoring !== null}
                      onClick={() => restore(v.number)}
                    >
                      <FiRotateCcw aria-hidden />
                      {restoring === v.number ? "Restoring…" : "Use as draft"}
                      <span className="sr-only">version {v.number}</span>
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
