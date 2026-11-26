import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import React from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider,
  SidebarTrigger,
} from "@pet-adopt/ui/components/sidebar";
import { getSettings } from "@/lib/queries";
import { resolveTheme } from "@/lib/theme";
import { getPluginNav } from "@/plugins/registry";
import type { SessionUser } from "@/server/types";

import { AdminNav } from "./AdminNav";
import { ADMIN_NAV } from "./nav-items";
import { UserMenu } from "./UserMenu";
import { ViewSiteLink } from "./ViewSiteLink";

// The frame around every admin screen: skip link, shadcn sidebar (a sheet on phones), header and <main>.
// TODO(ui): toaster (shadcn `sonner`) goes here once it is added.
export async function AdminShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  // The sidebar remembers open/closed in a cookie. Reading it here means the first paint already
  // has the right state, so the page does not jump after hydration.
  const [cookieStore, settings] = await Promise.all([cookies(), getSettings()]);
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";
  // The site's own name and logo (Settings > Brand), so owners see whose admin this is.
  const logo = settings.logo?.url ? settings.logo : null;

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      {/* First focusable element: lets keyboard users skip the navigation (WCAG 2.4.1). */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to main content
      </a>

      <Sidebar>
        <SidebarHeader>
          <Link
            href="/admin"
            className="flex min-w-0 items-center gap-2.5 rounded-md p-2 hover:bg-sidebar-accent"
          >
            {/* Decorative: the site name beside it is the link's text. */}
            {logo ? (
              <Image
                // The original, scaled to fit (thumbnails are 4:3 crops that cut a logo's edges).
                src={logo.url}
                alt=""
                width={32}
                height={32}
                className="size-8 shrink-0 rounded-md object-contain"
              />
            ) : null}
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate font-semibold">{settings.siteName}</span>
              <span className="text-xs text-muted-foreground">Admin</span>
            </span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          {/* Plugin screens from pet-adopt.config.ts get their own group. Only plain data crosses to the client nav. */}
          <AdminNav
            items={ADMIN_NAV}
            pluginItems={getPluginNav()}
            pluginsHref="/admin/plugins"
            role={user.role}
          />
        </SidebarContent>
        <SidebarFooter>
          <ViewSiteLink />
        </SidebarFooter>
      </Sidebar>

      {/* Not <SidebarInset>: it renders its own <main>, and this page already has one for the skip link. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-50 flex h-14 items-center gap-2 border-b bg-background px-3">
          <SidebarTrigger />
          <div className="ml-auto">
            <UserMenu user={user} canSwitchMode={resolveTheme(settings).allowModeToggle} />
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
