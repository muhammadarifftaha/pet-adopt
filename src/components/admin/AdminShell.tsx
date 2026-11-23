import { cookies } from "next/headers";
import Link from "next/link";
import React from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
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
  const defaultOpen = (await cookies()).get("sidebar_state")?.value !== "false";

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
            className="rounded-md px-2 py-1.5 font-semibold hover:bg-sidebar-accent"
          >
            Pet Adopt admin
          </Link>
        </SidebarHeader>
        <SidebarContent>
          {/* Plugin screens from pet-adopt.config.ts get their own group. Only plain data crosses to the client nav. */}
          <AdminNav
            items={ADMIN_NAV}
            pluginItems={getPluginNav()}
            isAdmin={user.role === "admin"}
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
            <UserMenu user={user} />
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
