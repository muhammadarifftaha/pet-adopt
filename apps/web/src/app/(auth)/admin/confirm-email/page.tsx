import type { Metadata } from "next";

import { ConfirmEmailForm } from "@/components/auth/ConfirmEmailForm";
import { ResetUnavailable } from "@/components/auth/ResetPasswordForm";
import { emailChangeFor } from "@/server/email-change";

export const metadata: Metadata = {
  title: "Confirm new email",
  // The token is in the address: never send it to another site in a Referer header.
  referrer: "no-referrer",
};

// Opened from the "Confirm new email" message (src/server/email-change.ts). Signed in or not: the
// link itself proves the person reads the new address. Opening it changes nothing until Confirm.
export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  const change = typeof token === "string" ? await emailChangeFor(token) : null;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-6 p-4">
      {change && typeof token === "string" ? (
        <ConfirmEmailForm token={token} name={change.name} email={change.email} />
      ) : (
        <ResetUnavailable title="This link no longer works">
          Confirmation links work once, for 24 hours. Ask for the change again on your Account page.
        </ResetUnavailable>
      )}
    </div>
  );
}
