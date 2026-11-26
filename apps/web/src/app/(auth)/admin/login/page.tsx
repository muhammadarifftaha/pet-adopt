import LoginForm from "@/components/auth/LoginForm";
import { ProviderSignIn } from "@/components/auth/ProviderSignIn";
import { errorCode, providerSignInError } from "@/lib/auth-provider-errors";
import { listEnabledProviders } from "@/server/auth-providers";
import { safeRedirectPath } from "@/lib/links";
import { redirect as goTo } from "next/navigation";

import { getSessionUser } from "@/server/session";
import { DELETION_GRACE_DAYS } from "@/server/users";
import { getSettings } from "@/server/settings";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[]; error?: string | string[]; closed?: string | string[] }>;
}) {
  // Someone who is already signed in has nothing to do here.
  if (await getSessionUser()) goTo(safeRedirectPath((await searchParams).redirect));
  // Providers are extra: if they cannot be read, the password form still works.
  const [settings, { redirect, error, closed }, providers] = await Promise.all([getSettings(), searchParams, listEnabledProviders().catch(() => [])]);
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
