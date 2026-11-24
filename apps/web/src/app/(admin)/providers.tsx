"use client";

import React from "react";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { SWRConfig } from "swr";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function Providers({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId: string;
}) {
  return (
    <>
      <NuqsAdapter>
        {/* key: a different signed-in person gets a fresh, empty cache. The cache is a plain
            in-memory Map (never localStorage): the lists include unlisted pets and, later, users,
            and must not outlive the session. */}
        <SWRConfig
          key={userId}
          value={{
            provider: () => new Map(),
            // Data only changes when an owner changes it here, so skip refetching on every tab focus.
            revalidateOnFocus: false,
            // A failed action (signed out, validation) will not fix itself by retrying.
            shouldRetryOnError: false,
          }}
        >
          <TooltipProvider>{children}</TooltipProvider>
        </SWRConfig>
      </NuqsAdapter>
    </>
  );
}
