import type { Metadata } from "next";
import React from "react";

import { ThemeStyle } from "@/components/site/ThemeStyle";
import { getSettings, siteIcons } from "@/lib/queries";

// First-time setup (/setup, src/server/setup.ts) gets its own root layout: it is used before any
// account exists and outside the admin's sidebar. Styled like the (auth) and (admin) layouts.
import "@pet-adopt/ui/globals.css";
import "../(frontend)/fonts";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: { default: "Set up your site", template: "%s | Setup" },
    robots: { index: false, follow: false },
    icons: siteIcons(await getSettings()),
    // The setup key is in the address: never send it to another site in a Referer header.
    referrer: "no-referrer",
  };
}

export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();
  return (
    // suppressHydrationWarning: the saved light/dark mode may be set on <html> before hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeStyle settings={settings} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">{children}</main>
      </body>
    </html>
  );
}
