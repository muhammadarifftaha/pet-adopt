"use client";
import React from "react";
import Link from "next/link";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { newPasswordSchema, NewPasswordSchemaType } from "@/lib/zod-schema/auth";
import { callAction } from "@/lib/admin/call-action";
import { acceptInviteAction } from "@/server/actions/password-reset";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@pet-adopt/ui/components/field";
import { Input } from "@pet-adopt/ui/components/input";
import { Button, buttonVariants } from "@pet-adopt/ui/components/button";
import { Card, CardContent, CardFooter, CardHeader } from "@pet-adopt/ui/components/card";

// /admin/invite: someone an admin invited chooses their first password, from the emailed (or
// shared) one-time link. Styled like the reset form. Accepting does not sign them in: they sign in
// next, which also runs the two-factor rules.
export function AcceptInviteForm({
  token,
  name,
  siteName,
  minLength,
}: {
  token: string;
  name: string;
  siteName: string;
  /** MIN_PASSWORD_LENGTH from the server. */
  minLength: number;
}) {
  const [done, setDone] = React.useState(false);
  const form = useForm<NewPasswordSchemaType>({
    resolver: zodResolver(newPasswordSchema(minLength)),
    values: { password: "", confirm: "" },
  });

  const onSubmit = async (values: NewPasswordSchemaType) => {
    // callAction: a call that never arrives (network, redeploy) becomes a message, not silence.
    const result = await callAction(acceptInviteAction({ token, password: values.password }));
    if (result.ok) {
      setDone(true);
      return;
    }
    const message = result.fieldErrors?.password;
    if (message) form.setError("password", { message });
    else form.setError("root", { message: result.error });
  };

  if (done) {
    return (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <h1 className="text-lg font-semibold">You’re all set</h1>
          <p role="status">Your password is saved. Sign in with your email and the new password.</p>
        </CardHeader>
        <CardFooter>
          <Field orientation="horizontal" className="w-full justify-end">
            <Link href="/admin/login" className={buttonVariants()}>
              Sign In
            </Link>
          </Field>
        </CardFooter>
      </Card>
    );
  }

  const rootError = form.formState.errors.root?.message;
  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <h1 className="text-lg font-semibold">Welcome to {siteName}</h1>
        <p>Hello {name}. Choose the password you will sign in with.</p>
      </CardHeader>
      <CardContent className="w-full">
        <form id="accept-invite-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            {rootError ? (
              <p role="alert" className="text-sm text-destructive">
                {rootError}
              </p>
            ) : null}
            <Controller
              name="password"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                  <Input
                    id={field.name}
                    type="password"
                    placeholder="Choose a password"
                    autoComplete="new-password"
                    aria-invalid={fieldState.invalid}
                    aria-describedby="password-hint"
                    {...field}
                  />
                  <FieldDescription id="password-hint">At least {minLength} characters.</FieldDescription>
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <Controller
              name="confirm"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Repeat password</FieldLabel>
                  <Input id={field.name} type="password" placeholder="Enter it again" autoComplete="new-password" aria-invalid={fieldState.invalid} {...field} />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <Field orientation="horizontal" className="w-full justify-end">
          <Button type="submit" form="accept-invite-form" aria-disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Saving…" : "Save password"}
          </Button>
        </Field>
      </CardFooter>
    </Card>
  );
}
