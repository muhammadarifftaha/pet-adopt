"use client";

import React from "react";

import { Button } from "@pet-adopt/ui/components/button";
import { callAction } from "@/lib/admin/call-action";
import { startProviderSignInAction } from "@/server/actions/auth-providers";
import type { PublicProvider } from "@/server/auth-providers";

/**
 * "Sign in with <provider>" buttons under the password form, and the message when a provider sign-in
 * came back with an error. Each button asks the server for the provider's address and goes there.
 */
export function ProviderSignIn({ providers, redirectTo, error }: { providers: PublicProvider[]; redirectTo: string; error: string | null }) {
  const [pending, setPending] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  async function start(slug: string) {
    if (pending) return;
    setPending(slug);
    setFailure(null);
    // callAction: a call that never arrives (network, redeploy) becomes a message, not a stuck button.
    const result = await callAction(startProviderSignInAction({ provider: slug, redirectTo }));
    if (result.ok) {
      window.location.assign(result.data.url);
      return;
    }
    setPending(null);
    setFailure(result.error);
  }

  const message = failure ?? error;
  if (!providers.length && !message) return null;
  return (
    <div className="flex w-full max-w-lg flex-col gap-3">
      {message ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {message}
        </p>
      ) : null}
      {providers.length ? (
        <>
          <p className="text-center text-sm text-muted-foreground">or</p>
          {providers.map((provider) => (
            <Button key={provider.slug} type="button" variant="outline" className="w-full" aria-disabled={pending !== null || undefined} onClick={() => start(provider.slug)}>
              {pending === provider.slug ? `Opening ${provider.name}…` : `Sign in with ${provider.name}`}
            </Button>
          ))}
        </>
      ) : null}
    </div>
  );
}
