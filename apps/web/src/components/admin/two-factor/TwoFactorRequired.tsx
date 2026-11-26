"use client";

import { useRouter } from "next/navigation";
import React from "react";

import { ROLE_INFO } from "@pet-adopt/plugin-sdk";
import { Button } from "@pet-adopt/ui/components/button";
import { Card, CardContent, CardHeader } from "@pet-adopt/ui/components/card";
import { signOutAction } from "@/server/actions/auth";
import type { SessionUser } from "@/server/types";

import { TwoFactorSetup } from "./TwoFactorSetup";

/**
 * Shown by the admin layout, in place of every admin screen, to someone whose role must use
 * two-factor sign-in and who has not set it up. The actions refuse them too, so this is the way on.
 */
export function TwoFactorRequired({ user, siteName }: { user: SessionUser; siteName: string }) {
  const router = useRouter();
  const [signingOut, startSignOut] = React.useTransition();

  function signOut() {
    startSignOut(async () => {
      await signOutAction();
      // A different root layout, so Next does a full page load (as the user menu's Sign out).
      router.replace("/admin/login");
    });
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <h1 className="text-lg font-semibold">Set up two-factor sign-in</h1>
          <p className="text-sm text-muted-foreground">
            {siteName} asks everyone with the {ROLE_INFO[user.role].label} role to sign in with a code from an authenticator app as well as a password. Set
            it up now to continue, {user.name}.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {/* Once it is on, reload: the layout then shows the admin screen they were headed to. */}
          <TwoFactorSetup siteName={siteName} onDone={() => window.location.reload()} />
          <div className="border-t pt-4">
            <Button type="button" variant="ghost" size="sm" aria-disabled={signingOut || undefined} onClick={signOut}>
              {signingOut ? "Signing out…" : "Sign out instead"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
