import { LoginForm } from "@/components/auth/LoginForm";
import { ProviderSignIn } from "@/components/auth/ProviderSignIn";
import { errorCode, providerSignInError } from "@/lib/auth-provider-errors";
import { listEnabledProviders } from "@/server/auth-providers";
import { safeRedirectPath } from "@/lib/links";
import { redirect as goTo } from "next/navigation";

import { getSessionUser } from "@/server/session";
import { DELETION_GRACE_DAYS } from "@/server/users";
import { hasAccounts } from "@/server/setup";
import { getSettings } from "@/server/settings";
import { logError } from "@/server/result";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[]; error?: string | string[]; closed?: string | string[] }>;
}) {
  // Someone who is already signed in has nothing to do here.
  if (await getSessionUser()) goTo(safeRedirectPath((await searchParams).redirect));
  // A new site has no accounts: the first one is made with the setup link (src/server/setup.ts).
  // If that cannot be read, show the form: signing in then reports the problem.
  const accounts = await hasAccounts().catch((failure: unknown) => {
    logError(failure, "sign-in page: could not count accounts");
    return true;
  });
  if (!accounts) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-4">
        <section className="w-full max-w-lg rounded-lg border p-6">
          <h1 className="text-lg font-semibold">This site is not set up yet</h1>
          <p className="mt-2 text-sm">
            There are no accounts yet. Whoever deployed it creates the first one with the setup link printed in the server’s log (it starts with{" "}
            <code className="break-all">/setup?key=</code>).
          </p>
        </section>
      </div>
    );
  }
  // Providers are extra: if they cannot be read, the password form still works.
  const [settings, { redirect, error, closed }, providers] = await Promise.all([
    getSettings(),
    searchParams,
    listEnabledProviders().catch((failure: unknown) => {
      logError(failure, "sign-in page: could not read sign-in providers");
      return [];
    }),
  ]);
  // A sign-in provider that came back with an error (Better Auth adds ?error=<code>).
  const code = errorCode(error);
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-4">
      {closed === "1" ? (
        // After "Delete my account" (src/server/users.ts, requestOwnDeletion).
        <p role="status" className="w-full max-w-lg rounded-md border p-3 text-sm">
          Your account is closed and will be deleted in {DELETION_GRACE_DAYS} days. To keep it, ask an admin to restore it before then.
        </p>
      ) : null}
      <LoginForm settings={settings} redirectTo={safeRedirectPath(redirect)} />
      <ProviderSignIn providers={providers} redirectTo={safeRedirectPath(redirect)} error={code ? providerSignInError(code) : null} />
    </div>
  );
}
