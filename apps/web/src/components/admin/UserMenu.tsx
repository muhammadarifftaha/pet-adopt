"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FiChevronDown, FiLogOut, FiMoon, FiUser } from "react-icons/fi";

import { Avatar, AvatarFallback } from "@pet-adopt/ui/components/avatar";
import { Badge } from "@pet-adopt/ui/components/badge";
import { buttonVariants } from "@pet-adopt/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pet-adopt/ui/components/dropdown-menu";
import { initialsOf } from "@/lib/admin/initials";
import { useColorMode } from "@/lib/color-mode";
import { ROLE_INFO } from "@pet-adopt/plugin-sdk";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/server/actions/auth";
import type { SessionUser } from "@/server/types";

// Who is signed in: an avatar with their initials and name, opening a menu with the Account page, a
// Dark mode switch (only when the site has dark mode, Site settings > Brand) and Sign out. The mode is
// kept in this browser and shared with the public site's switch (src/lib/color-mode.ts). (Owners
// have no profile picture yet; give AvatarFallback an <AvatarImage> when they do.)
export function UserMenu({ user, canSwitchMode = false }: { user: SessionUser; canSwitchMode?: boolean }) {
  const [mode, setMode] = useColorMode();
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function signOut() {
    setSigningOut(true);
    setError(null);
    const result = await signOutAction();
    if (result.ok) {
      // The sign-in page is a different root layout, so Next does a full page load. That also drops
      // everything this tab held for the person (the in-memory SWR cache, form state).
      router.replace("/admin/login");
      return;
    }
    setSigningOut(false);
    setError(result.error);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: "ghost" }), "h-9 gap-2 px-2")}
      >
        {/* Decorative: the name next to it is the accessible name of the button. */}
        <Avatar aria-hidden="true">
          <AvatarFallback>{initialsOf(user.name, user.email)}</AvatarFallback>
        </Avatar>
        <span className="max-w-32 truncate text-sm font-medium sm:max-w-48">
          {user.name}
        </span>
        <FiChevronDown aria-hidden="true" className="text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-1 py-2">
            <span className="text-sm font-medium text-foreground">
              {user.name}
            </span>
            <span className="truncate">{user.email}</span>
            <Badge variant="secondary" className="w-fit capitalize">
              {ROLE_INFO[user.role].label}
            </Badge>
          </DropdownMenuLabel>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link href="/admin/account" />}>
            <FiUser aria-hidden="true" />
            Account
          </DropdownMenuItem>
          {canSwitchMode ? (
            // A checkbox item (menuitemcheckbox): its tick and aria-checked say whether dark is on.
            // closeOnClick={false}: the change shows at once and the menu stays for another try.
            <DropdownMenuCheckboxItem
              checked={mode === "dark"}
              disabled={mode === null}
              closeOnClick={false}
              onCheckedChange={(checked) => setMode(checked ? "dark" : "light")}
            >
              <FiMoon aria-hidden="true" />
              Dark mode
            </DropdownMenuCheckboxItem>
          ) : null}
          {/* closeOnClick={false}: the menu stays open while signing out, so a failure can show here. */}
          <DropdownMenuItem
            closeOnClick={false}
            disabled={signingOut}
            onClick={signOut}
          >
            <FiLogOut aria-hidden="true" />
            {signingOut ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuGroup>

        {error ? (
          <p role="alert" className="px-1.5 py-1 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
