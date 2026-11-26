"use client";

import { useRouter } from "next/navigation";
import React from "react";

import { ROLE_INFO, ROLES, type Role } from "@pet-adopt/plugin-sdk";
import { Button } from "@pet-adopt/ui/components/button";
import { Card, CardContent, CardHeader } from "@pet-adopt/ui/components/card";
import { Checkbox } from "@pet-adopt/ui/components/checkbox";
import { Field, FieldContent, FieldLabel } from "@pet-adopt/ui/components/field";
import { useViewOnly } from "@/components/admin/view-only";
import { saveTwoFactorRolesAction } from "@/server/actions/two-factor";

/**
 * Which roles must use two-factor sign-in (admins only; others see it read-only). Anyone in a ticked
 * role who has not set it up is shown the setup before anything else, the admin saving included.
 */
export function TwoFactorRoles({ roles, meRole, meEnabled }: { roles: Role[]; meRole: Role; meEnabled: boolean }) {
  const router = useRouter();
  const viewOnly = useViewOnly();
  const [picked, setPicked] = React.useState<Role[]>(roles);
  const [message, setMessage] = React.useState<{ text: string; isError: boolean; id: number } | null>(null);
  const [pending, startTransition] = React.useTransition();
  const changed = picked.join() !== roles.join();
  const locksMeOut = picked.includes(meRole) && !meEnabled;

  function toggle(role: Role, on: boolean) {
    setPicked((current) => ROLES.filter((r) => (r === role ? on : current.includes(r))));
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !changed) return;
    startTransition(async () => {
      const result = await saveTwoFactorRolesAction({ roles: picked });
      setMessage((previous) => ({ text: result.ok ? "Saved." : result.error, isError: !result.ok, id: (previous?.id ?? 0) + 1 }));
      if (result.ok) router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold">Require two-factor sign-in</h2>
        <p className="text-sm text-muted-foreground">
          People in the ticked roles must sign in with a code from an authenticator app as well as their password. Anyone who has not set it up is asked to
          before they can do anything else.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="flex flex-col gap-4">
          <fieldset disabled={viewOnly} className="flex flex-col gap-3">
            <legend className="sr-only">Roles that must use two-factor</legend>
            {ROLES.map((role) => (
              <Field key={role} orientation="horizontal">
                <Checkbox id={`tf-role-${role}`} checked={picked.includes(role)} onCheckedChange={(checked) => toggle(role, checked === true)} disabled={viewOnly} />
                <FieldContent>
                  <FieldLabel htmlFor={`tf-role-${role}`}>{ROLE_INFO[role].label}</FieldLabel>
                </FieldContent>
              </Field>
            ))}
          </fieldset>
          {locksMeOut && changed ? (
            <p className="text-sm">Your own role is ticked and your two-factor is off: you will be asked to set it up as soon as you save.</p>
          ) : null}
          {viewOnly ? null : (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" aria-disabled={pending || !changed || undefined}>
                {pending ? "Saving…" : "Save"}
              </Button>
              <p aria-live="polite" className={`text-sm ${message?.isError ? "text-destructive" : ""}`}>
                {message ? <span key={message.id}>{message.text}</span> : null}
              </p>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
