"use client";

import { usePathname, useRouter } from "next/navigation";
import React from "react";

import { Button } from "@pet-adopt/ui/components/button";
import { Input } from "@pet-adopt/ui/components/input";
import { Label } from "@pet-adopt/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@pet-adopt/ui/components/select";
import { ACTIVITY_AREA_LABELS, ACTIVITY_AREAS } from "@/lib/activity";
import { useSiteTimeZone } from "@/components/admin/site-time";
import { dayInZone, startOfDayInZone } from "@pet-adopt/plugin-sdk";

// Filters for the activity log, kept in the URL (?area=&actor=&from=&to=), so a view can be linked
// to and the back button works. Dates are picked as days in the site's time zone (the viewer's own without one) and sent as
// the instants they start at (`from`) and the instant after the last one ends (`to`, exclusive).

export type ActivityFilterValues = { area: string | null; actor: string | null; from: string | null; to: string | null };

/** The day (YYYY-MM-DD) an instant falls on, for a date input. */
function dayOf(iso: string | null, timeZone: string | null, endExclusive = false): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  // `to` is the instant after the last day ends: one millisecond earlier is still that day.
  return dayInZone(endExclusive ? date.getTime() - 1 : date, timeZone);
}

/** The instant a day starts at (or, with `next`, the day after it). */
function dayStart(day: string, timeZone: string | null, next = false): string | null {
  // Typing a year digit by digit passes through 0002, 0020...: only real years count.
  if (Number(day.slice(0, 4)) < 1970) return null;
  return startOfDayInZone(day, timeZone, next ? 1 : 0)?.toISOString() ?? null;
}

export function ActivityFilters({
  values,
  actors,
}: {
  values: ActivityFilterValues;
  /** Everyone with entries; empty when the viewer only sees their own. */
  actors: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = React.useTransition();
  const id = React.useId();
  const timeZone = useSiteTimeZone();
  // The date boxes, kept in step with the URL when it changes from elsewhere (Back, Clear filters)
  // without re-creating them, which would move keyboard focus.
  const [from, setFrom] = React.useState(dayOf(values.from, timeZone));
  const [to, setTo] = React.useState(dayOf(values.to, timeZone, true));
  const [seen, setSeen] = React.useState({ from: values.from, to: values.to });
  if (seen.from !== values.from || seen.to !== values.to) {
    setSeen({ from: values.from, to: values.to });
    setFrom(dayOf(values.from, timeZone));
    setTo(dayOf(values.to, timeZone, true));
  }

  function apply(change: Partial<ActivityFilterValues>) {
    const next = { ...values, ...change };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
    // Any change of filter starts again at page 1 (no `page`).
    startTransition(() => router.push(params.size ? `${pathname}?${params}` : pathname));
  }

  const areaItems = [{ value: null, label: "All areas" }, ...ACTIVITY_AREAS.map((area) => ({ value: area as string | null, label: ACTIVITY_AREA_LABELS[area] }))];
  const actorItems = [{ value: null, label: "Everyone" }, ...actors.map((actor) => ({ value: actor.id as string | null, label: actor.name }))];
  const filtered = Boolean(values.area || values.actor || values.from || values.to);

  return (
    <div className="flex flex-wrap items-end gap-4" aria-busy={pending || undefined}>
      <div className="flex flex-col gap-1.5">
        <Label id={`${id}-area`}>Area</Label>
        <Select items={areaItems} value={values.area} onValueChange={(value) => apply({ area: (value as string | null) || null })}>
          <SelectTrigger className="w-52" aria-labelledby={`${id}-area`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {areaItems.map((item) => (
              <SelectItem key={item.value ?? "all"} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {actors.length ? (
        <div className="flex flex-col gap-1.5">
          <Label id={`${id}-actor`}>Person</Label>
          <Select items={actorItems} value={values.actor} onValueChange={(value) => apply({ actor: (value as string | null) || null })}>
            <SelectTrigger className="w-52" aria-labelledby={`${id}-actor`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {actorItems.map((item) => (
                <SelectItem key={item.value ?? "everyone"} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-from`}>From</Label>
        <Input
          id={`${id}-from`}
          type="date"
          className="w-44"
          value={from}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setFrom(value);
            if (!value) apply({ from: null });
            else if (dayStart(value, timeZone)) apply({ from: dayStart(value, timeZone) });
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-to`}>To</Label>
        <Input
          id={`${id}-to`}
          type="date"
          className="w-44"
          value={to}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setTo(value);
            if (!value) apply({ to: null });
            else if (dayStart(value, timeZone, true)) apply({ to: dayStart(value, timeZone, true) });
          }}
        />
      </div>

      {filtered ? (
        <Button type="button" variant="ghost" onClick={() => apply({ area: null, actor: null, from: null, to: null })}>
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
