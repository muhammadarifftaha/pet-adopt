"use client";

import { useRouter } from "next/navigation";
import React from "react";

import { Badge } from "@pet-adopt/ui/components/badge";
import { Button } from "@pet-adopt/ui/components/button";
import { Card, CardContent, CardHeader } from "@pet-adopt/ui/components/card";
import { connectProviderAction, disconnectProviderAction, type MyProvider } from "@/server/actions/auth-providers";

/**
 * Sign-in providers on the Account page: connect one (you sign in at the provider and come back),
 * after which it signs you in here; or disconnect it. Your password always keeps working.
 * `notice` is the result of a connection that just came back (?connected= or ?error=).
 */
export function ConnectedProviders({ providers, notice }: { providers: MyProvider[]; notice: { text: string; isError: boolean } | null }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState(notice);

  async function connect(provider: MyProvider) {
    if (pending) return;
    setPending(provider.slug);
    const result = await connectProviderAction(provider.slug);
    if (result.ok) {
      window.location.assign(result.data.url);
      return;
    }
    setPending(null);
    setMessage({ text: result.error, isError: true });
  }

  async function disconnect(provider: MyProvider) {
    if (pending) return;
    setPending(provider.slug);
    const result = await disconnectProviderAction(provider.slug);
    setPending(null);
    setMessage(result.ok ? { text: `${provider.name} is disconnected.`, isError: false } : { text: result.error, isError: true });
    if (result.ok) router.refresh();
  }

  if (!providers.length) return null;
  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold">Sign-in providers</h2>
        <p className="text-sm text-muted-foreground">
          Connect an outside account to sign in with it instead of your password. It counts as two-factor. Your password keeps working.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {message ? (
          <p role={message.isError ? "alert" : "status"} className={`text-sm ${message.isError ? "text-destructive" : ""}`}>
            {message.text}
          </p>
        ) : null}
        <ul className="flex flex-col divide-y rounded-lg border">
          {providers.map((provider) => (
            <li key={provider.slug} className="flex flex-wrap items-center gap-3 p-3">
              <span className="mr-auto flex items-center gap-2">
                <span className="font-medium">{provider.name}</span>
                {provider.connected ? <Badge>Connected</Badge> : <Badge variant="outline">Not connected</Badge>}
              </span>
              {provider.connected ? (
                <Button type="button" variant="outline" size="sm" aria-disabled={pending !== null || undefined} onClick={() => disconnect(provider)}>
                  {pending === provider.slug ? "Disconnecting…" : "Disconnect"}
                  <span className="sr-only">{provider.name}</span>
                </Button>
              ) : (
                <Button type="button" size="sm" aria-disabled={pending !== null || undefined} onClick={() => connect(provider)}>
                  {pending === provider.slug ? `Opening ${provider.name}…` : "Connect"}
                  <span className="sr-only">{provider.name}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
