import type { Metadata } from "next";
import React from "react";

import { ThemeStyle } from "@/components/site/ThemeStyle";
import { getSettings, siteIcons } from "@/lib/queries";

// Same styling setup as the (admin) layout: Tailwind and the shadcn tokens bridged to the site
// theme, plus the self-hosted fonts. Do NOT import ../(frontend)/styles.css here (see the note in
// the (admin) layout).
import "@pet-adopt/ui/globals.css";
import "../(frontend)/fonts";
import AuthNav from "@/components/auth/AuthNav";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: { default: "Sign in", template: "%s | Admin" },
    robots: { index: false, follow: false },
    icons: siteIcons(await getSettings()),
  };
}

// Layout for the signed-out screens (sign in, and later anything like it). This is a separate root
// layout from (admin), so it renders its own <html> and <body>; going from here to /admin is a full
// page load, which is fine for a sign-in.
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Signed-in people may be here: confirming a new email (/admin/confirm-email) is usually done
  // while signed in. The sign-in page itself sends them to the admin.
  const settings = await getSettings();
  return (
    // suppressHydrationWarning: the saved light/dark mode may be set on <html> before hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeStyle settings={settings} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased w-full flex flex-col items-center justify-center">
        <header className="w-full flex items-start justify-between py-2 px-4 border-b border-border text-muted-foreground">
          <p className="text-sm">{settings.siteName} </p>
          <AuthNav />
        </header>
        <main className="flex flex-auto items-center justify-center px-4 py-12 w-full">
          {children}
        </main>
      </body>
    </html>
  );
}
