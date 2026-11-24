import LoginForm from "@/components/auth/LoginForm";
import { safeRedirectPath } from "@/lib/links";
import { getSettings } from "@/server/settings";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[] }>;
}) {
  const [settings, { redirect }] = await Promise.all([getSettings(), searchParams]);
  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-4">
      <LoginForm settings={settings} redirectTo={safeRedirectPath(redirect)} />
    </div>
  );
}
