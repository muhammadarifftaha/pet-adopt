import type { Metadata } from "next";

import {
  NewPasswordForm,
  RequestResetForm,
  ResetUnavailable,
} from "@/components/auth/ResetPasswordForm";
import { getEmailSender } from "@/server/email";
import { MIN_PASSWORD_LENGTH } from "@/server/auth";
import { isResetTokenValid } from "@/server/password-reset";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = {
  title: "Reset password",
  // The token is in the address: never send it to another site in a Referer header.
  referrer: "no-referrer",
};

const ASK_ADMIN = "Ask an admin of this site for a new reset link.";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const [settings, { token }] = await Promise.all([getSettings(), searchParams]);
  const canEmail = (await getEmailSender()) !== null;

  let content: React.ReactNode;
  if (token === undefined) {
    content = canEmail ? (
      <RequestResetForm siteName={settings.siteName} />
    ) : (
      <ResetUnavailable title="Reset your password">
        This site does not send email. {ASK_ADMIN} They can make one for you on the Users screen.
      </ResetUnavailable>
    );
  } else if (typeof token === "string" && (await isResetTokenValid(token))) {
    // Opened from a working reset link.
    content = <NewPasswordForm token={token} minLength={MIN_PASSWORD_LENGTH} />;
  } else {
    content = (
      <>
        <ResetUnavailable title="This link no longer works">
          Reset links work once, for one hour. {canEmail ? "Ask for a new one below." : ASK_ADMIN}
        </ResetUnavailable>
        {/* The card above holds the page's <h1>. */}
        {canEmail && <RequestResetForm siteName={settings.siteName} heading="h2" />}
      </>
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-6 p-4">
      {content}
    </div>
  );
}
