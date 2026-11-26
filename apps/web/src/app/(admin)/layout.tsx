import type { Metadata } from "next";
import { redirect } from "next/navigation";
import React from "react";

import { ThemeStyle } from "@/components/site/ThemeStyle";
import { getSettings, siteIcons } from "@/lib/queries";
import { getSessionUser } from "@/server/session";
import { needsTwoFactorSetup } from "@/server/two-factor";
import { TwoFactorRequired } from "@/components/admin/two-factor/TwoFactorRequired";
import { EmailConfirmBanner } from "@/components/admin/EmailConfirmBanner";
import { needsEmailConfirmation } from "@/server/email-change";

// Tailwind and the shadcn tokens, bridged to the site theme (see the notes in globals.css).
import "@pet-adopt/ui/globals.css";
// Self-hosted fonts. The theme decides which one is used.
import "../(frontend)/fonts";
import Providers from "./providers";
// Do NOT import ../(frontend)/styles.css here: it is unlayered plain CSS, so it would beat
// Tailwind's utilities (for example the link colour) and fight with the shadcn components.

// Tabs read "Pets | <site name> admin", so owners with several sites can tell them apart.
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const { siteName } = settings;
  return {
    title: { default: `${siteName} admin`, template: `%s | ${siteName} admin` },
    // The admin is for the owners only.
    robots: { index: false, follow: false },
    icons: siteIcons(settings),
  };
}

export default async function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Everything under (admin) is for signed-in owners. The sign-in page lives in the separate (auth)
  // group, so this cannot loop. Each action still checks the session itself: this guard only
  // keeps signed-out visitors from seeing the screens. (A layout cannot read the current path, so
  // the sign-in form cannot know where the person was headed; it goes to /admin afterwards.)
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const settings = await getSettings();
  // Their role must use two-factor sign-in and they have not set it up: that setup, and nothing
  // else, on every admin address (a layout cannot read the path, so no redirect loop to avoid).
  // The actions refuse too (requirePermission).
  const setupFirst = await needsTwoFactorSetup(user);
  // Not confirmed their email (while the site can send email): a banner, and changes are refused.
  const confirmFirst = !setupFirst && (await needsEmailConfirmation(user));
  return (
    // suppressHydrationWarning: a small script may set data-mode on <html> (the owner's saved
    // light/dark choice) before React hydrates, exactly like the public layout.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Writes the theme's CSS variables (--bg, --ink, --primary ...) that globals.css maps
            shadcn's colours onto, plus the light/dark pre-paint script. */}
        <ThemeStyle settings={settings} />
      </head>
      {/* The page background, text colour and font come from the shadcn tokens, which follow the theme. */}
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <Providers userId={user.id}>
          {setupFirst ? (
            <TwoFactorRequired user={user} siteName={settings.siteName} />
          ) : (
            <>
              {confirmFirst ? <EmailConfirmBanner email={user.email} /> : null}
              {children}
            </>
          )}
        </Providers>
      </body>
    </html>
  );
}
