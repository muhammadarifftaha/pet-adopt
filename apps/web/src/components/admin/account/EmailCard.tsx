"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import React from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@pet-adopt/ui/components/button";
import { Card, CardContent, CardFooter, CardHeader } from "@pet-adopt/ui/components/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@pet-adopt/ui/components/field";
import { Input } from "@pet-adopt/ui/components/input";
import { cancelEmailChangeAction, requestEmailChangeAction, type EmailChangeStatus } from "@/server/actions/email-change";
import type { SessionUser } from "@/server/types";
import { useWhen } from "@/components/admin/site-time";

// The Account page's email: the address you sign in with. A change needs your current password and
// is confirmed from the new address (src/server/email-change.ts); the old one gets a notice. Without
// email on the site, an admin changes it instead.

const schema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your current password"),
});
type Values = z.infer<typeof schema>;

export function EmailCard({ user, status }: { user: SessionUser; status: EmailChangeStatus }) {
  const when = useWhen();
  const router = useRouter();
  const [message, setMessage] = React.useState<string | null>(null);
  const [cancelling, startCancel] = React.useTransition();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });

  const onSubmit = async (values: Values) => {
    setMessage(null);
    const result = await requestEmailChangeAction(values);
    if (!result.ok) {
      let placed = false;
      for (const [name, text] of Object.entries(result.fieldErrors ?? {})) {
        if (name === "email" || name === "password") {
          form.setError(name, { message: text });
          placed = true;
        }
      }
      if (!placed) form.setError("root", { message: result.error });
      return;
    }
    form.reset();
    setMessage(`A confirmation link was sent to ${result.data.email}. Open it to finish the change.`);
    router.refresh();
  };

  function cancel() {
    startCancel(async () => {
      const result = await cancelEmailChangeAction();
      setMessage(result.ok ? "The change is cancelled. Its link no longer works." : result.error);
      if (result.ok) router.refresh();
    });
  }

  const pending = status.pending;
  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold">Email</h2>
        <p className="text-sm text-muted-foreground">
          You sign in with <strong className="break-all text-foreground">{user.email}</strong>. Reset links and invites go there too. Sign-in providers you
          connected are not affected by a change.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p role="status" className="text-sm empty:hidden">
          {message}
        </p>
        {pending ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
            <span className="mr-auto">
              Waiting for confirmation from <strong className="break-all">{pending.email}</strong> until {when(pending.expiresAt)}.
            </span>
            <Button type="button" variant="outline" size="sm" onClick={cancel} aria-disabled={cancelling || undefined}>
              {cancelling ? "Cancelling…" : "Cancel change"}
            </Button>
          </div>
        ) : null}
        {status.canChange ? (
          <form id="account-email-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
            {/* For password managers: which account the password belongs to. */}
            <input type="email" name="username" autoComplete="username" value={user.email} readOnly hidden />
            <FieldGroup>
              {form.formState.errors.root?.message ? (
                <p role="alert" className="text-sm text-destructive">
                  {form.formState.errors.root.message}
                </p>
              ) : null}
              <Controller
                name="email"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="account-new-email">New email</FieldLabel>
                    <Input id="account-new-email" type="email" autoComplete="email" maxLength={200} aria-invalid={fieldState.invalid} {...field} />
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
              <Controller
                name="password"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="account-email-password">Current password</FieldLabel>
                    <Input id="account-email-password" type="password" autoComplete="current-password" aria-invalid={fieldState.invalid} {...field} />
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
            </FieldGroup>
          </form>
        ) : (
          <p className="text-sm">This site cannot send email, so an admin changes your email for you (Users screen).</p>
        )}
      </CardContent>
      {status.canChange ? (
        <CardFooter className="justify-end">
          <Button type="submit" form="account-email-form" aria-disabled={form.formState.isSubmitting || undefined}>
            {form.formState.isSubmitting ? "Sending…" : "Send confirmation link"}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
