import type { Metadata } from "next";

import { AcceptInviteForm } from "@/components/auth/AcceptInviteForm";
import { ResetUnavailable } from "@/components/auth/ResetPasswordForm";
import { MIN_PASSWORD_LENGTH } from "@/server/auth";
import { isInviteTokenValid } from "@/server/invites";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = {
  title: "Accept invite",
  // The token is in the address: never send it to another site in a Referer header.
  referrer: "no-referrer",
};

// An admin invited this person (src/server/invites.ts): they choose their first password here.
export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const [settings, { token }] = await Promise.all([getSettings(), searchParams]);
  const invite = typeof token === "string" ? await isInviteTokenValid(token) : null;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-6 p-4">
      {invite && typeof token === "string" ? (
        <AcceptInviteForm token={token} name={invite.name} siteName={settings.siteName} minLength={MIN_PASSWORD_LENGTH} />
      ) : (
        <ResetUnavailable title="This invite no longer works">
          Invite links work once, for 7 days. Ask the admin who invited you to send a new one.
        </ResetUnavailable>
      )}
    </div>
  );
}
