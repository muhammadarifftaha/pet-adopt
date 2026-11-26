"use client";

import React from "react";
import { FiDownload } from "react-icons/fi";

import { Badge } from "@pet-adopt/ui/components/badge";
import { Button } from "@pet-adopt/ui/components/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@pet-adopt/ui/components/table";
import { ACTIVITY_AREA_LABELS, fieldLabel, isActivityArea } from "@/lib/activity";
import { exportActivityCsvAction } from "@/server/actions/activity";

import type { ActivityFilterValues } from "./ActivityFilters";

// The activity log's entries and its CSV download. Times are shown in the viewer's own timezone
// and locale (this is a client component for that reason); the CSV has them in UTC.

export type ActivityRow = {
  id: number;
  at: Date | string;
  actorId: string | null;
  actorName: string | null;
  area: string;
  summary: string;
  fields: string[] | null;
  client: string | null;
};

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function Time({ at }: { at: Date | string }) {
  const date = new Date(at);
  // The server renders in its own timezone; the browser corrects it (hence the warning is muted).
  return (
    <time dateTime={date.toISOString()} suppressHydrationWarning>
      {when.format(date)}
    </time>
  );
}

const areaLabel = (area: string) => (isActivityArea(area) ? ACTIVITY_AREA_LABELS[area] : area);

function Who({ row, meId }: { row: ActivityRow; meId: string }) {
  if (!row.actorId) return <span className="text-muted-foreground">Nobody signed in</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-medium">{row.actorName ?? "Unknown"}</span>
      {row.actorId === meId ? <Badge variant="outline">You</Badge> : null}
    </span>
  );
}

function What({ row }: { row: ActivityRow }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span>{row.summary}</span>
      {row.fields?.length ? <span className="text-sm text-muted-foreground">Changed: {row.fields.map(fieldLabel).join(", ")}</span> : null}
    </span>
  );
}

export function ActivityList({ rows, meId, showClient }: { rows: ActivityRow[]; meId: string; showClient: boolean }) {
  if (!rows.length) return <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">Nothing recorded for these filters.</p>;
  return (
    <>
      {/* Phones: one card per entry. From sm up: the table. Only one is displayed. */}
      <ul className="flex flex-col gap-3 sm:hidden" aria-label="Activity">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
            <span className="text-muted-foreground">
              <Time at={row.at} /> · {areaLabel(row.area)}
            </span>
            <Who row={row} meId={meId} />
            <What row={row} />
            {showClient && row.client ? <span className="text-muted-foreground break-all">From {row.client}</span> : null}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-lg border sm:block">
        <Table>
          <caption className="sr-only">Activity, newest first.</caption>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>What happened</TableHead>
              <TableHead>Area</TableHead>
              {showClient ? <TableHead>Address</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="align-top">
                <TableCell className="whitespace-nowrap">
                  <Time at={row.at} />
                </TableCell>
                <TableCell>
                  <Who row={row} meId={meId} />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <What row={row} />
                </TableCell>
                <TableCell className="whitespace-nowrap">{areaLabel(row.area)}</TableCell>
                {showClient ? <TableCell className="break-all text-muted-foreground">{row.client ?? "—"}</TableCell> : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/** Downloads the entries matching the filters (all pages) as CSV. Admins and audit only. */
export function ExportActivityButton({ filters, disabled }: { filters: ActivityFilterValues; disabled: boolean }) {
  const [pending, startTransition] = React.useTransition();
  const [status, setStatus] = React.useState<{ text: string; isError: boolean } | null>(null);

  function download() {
    if (pending || disabled) return;
    startTransition(async () => {
      const result = await exportActivityCsvAction(filters);
      if (!result.ok) {
        setStatus({ text: result.error, isError: true });
        return;
      }
      const url = URL.createObjectURL(new Blob([result.data.csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.data.filename;
      link.click();
      URL.revokeObjectURL(url);
      setStatus({
        text: result.data.truncated
          ? `Downloaded ${result.data.filename} with the newest ${result.data.rows} entries. Narrow the dates to get the rest.`
          : `Downloaded ${result.data.filename}.`,
        isError: false,
      });
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" onClick={download} aria-disabled={pending || disabled || undefined}>
        <FiDownload aria-hidden />
        {pending ? "Preparing…" : "Download CSV"}
      </Button>
      <p aria-live="polite" className="text-sm">
        {status && !status.isError ? status.text : null}
      </p>
      {status?.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {status.text}
        </p>
      ) : null}
    </div>
  );
}
