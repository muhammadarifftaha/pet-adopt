import LoginForm from "@/components/auth/LoginForm";
import { ProviderSignIn } from "@/components/auth/ProviderSignIn";
import { errorCode, providerSignInError } from "@/lib/auth-provider-errors";
import { listEnabledProviders } from "@/server/auth-providers";
import { safeRedirectPath } from "@/lib/links";
import { getSettings } from "@/server/settings";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[]; error?: string | string[] }>;
}) {
  // Providers are extra: if they cannot be read, the password form still works.
  const [settings, { redirect, error }, providers] = await Promise.all([getSettings(), searchParams, listEnabledProviders().catch(() => [])]);
  // A sign-in provider that came back with an error (Better Auth adds ?error=<code>).
  const code = errorCode(error);
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-4">
      <LoginForm settings={settings} redirectTo={safeRedirectPath(redirect)} />
      <ProviderSignIn providers={providers} redirectTo={safeRedirectPath(redirect)} error={code ? providerSignInError(code) : null} />
    </div>
  );
}
