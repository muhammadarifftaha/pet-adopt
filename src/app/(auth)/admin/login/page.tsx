import LoginForm from "@/components/auth/LoginForm";
import { getSettings } from "@/server/settings";

export default async function AdminLoginPage() {
  const settings = await getSettings();
  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-4">
      <LoginForm settings={settings} />
    </div>
  );
}
