"use client";

import { formatWhen, type WhenStyle } from "@pet-adopt/plugin-sdk";
import React from "react";

// The site's time zone (Site settings > Region) for the admin's client components. Every time the
// admin shows goes through `useWhen()`, so all screens agree and the server and the browser draw
// the same text. Without a site time zone each person sees their own device's time, and the
// server's first draw may differ from the browser's: wrap such text in <Time> or mute the warning.

const SiteTimeZone = React.createContext<string | null>(null);

export function SiteTimeProvider({ timeZone, children }: { timeZone: string | null; children: React.ReactNode }) {
  return <SiteTimeZone.Provider value={timeZone}>{children}</SiteTimeZone.Provider>;
}

/** The site's time zone (an IANA name), or null when none is chosen. */
export function useSiteTimeZone(): string | null {
  return React.useContext(SiteTimeZone);
}

/** Formats a date in the site's time zone: `when(date)` or `when(date, "date")`. */
export function useWhen(): (value: Date | string | number, style?: WhenStyle) => string {
  const timeZone = useSiteTimeZone();
  return React.useCallback((value, style) => formatWhen(value, timeZone, style), [timeZone]);
}
