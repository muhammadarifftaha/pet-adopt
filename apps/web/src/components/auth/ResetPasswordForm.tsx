"use client";
import React from "react";
import Link from "next/link";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  newPasswordSchema,
  NewPasswordSchemaType,
  resetRequestSchema,
  ResetRequestSchemaType,
} from "@/lib/zod-schema/auth";
import {
  requestPasswordResetAction,
  resetPasswordWithTokenAction,
} from "@/server/actions/password-reset";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Button, buttonVariants } from "../ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card";

// The two forms of /admin/reset-password, styled like the sign-in form:
//  - RequestResetForm: "email me a link" (only shown when an email plugin is set up);
//  - NewPasswordForm: choose a new password, opened from a reset link.
// The server answers "request" the same way whether or not the account exists, so the success
// message must not claim that an email was sent.

/** A link styled like a button, kept a real link (see AuthNav). */
const signInLink = (
  <Link href="/admin/login" className={buttonVariants({ variant: "outline" })}>
    Back to sign in
  </Link>
);

function RootError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

export function RequestResetForm({ siteName }: { siteName: string }) {
  const [sent, setSent] = React.useState(false);
  const form = useForm<ResetRequestSchemaType>({
    resolver: zodResolver(resetRequestSchema),
    values: { email: "" },
  });

  const onSubmit = async (values: ResetRequestSchemaType) => {
    const result = await requestPasswordResetAction(values);
    if (result.ok) {
      setSent(true);
      return;
    }
    const message = result.fieldErrors?.email;
    if (message) form.setError("email", { message });
    else form.setError("root", { message: result.error });
  };

  if (sent) {
    return (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <h2 className="text-lg font-semibold">Check your email</h2>
          {/* role="status" so screen readers hear the change after submitting. */}
          <p role="status">
            If an account on {siteName} uses that address, a link to choose a new password is on its
            way. It works once, for one hour. Nothing arrived? Check your spam folder, or ask an
            admin for a link.
          </p>
        </CardHeader>
        <CardFooter>
          <Field orientation="horizontal" className="w-full justify-end">
            {signInLink}
          </Field>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <h2 className="text-lg font-semibold">Reset your password</h2>
        <p>
          Enter the email you sign in to {siteName} with, and we will send you a link to choose a
          new password.
        </p>
      </CardHeader>
      <CardContent className="w-full">
        <form id="reset-request-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <RootError message={form.formState.errors.root?.message} />
            <Controller
              name="email"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                  <Input
                    id={field.name}
                    type="email"
                    placeholder="Enter your email"
                    autoComplete="username"
                    aria-invalid={fieldState.invalid}
                    {...field}
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <Field orientation="horizontal" className="w-full justify-end">
          {signInLink}
          <Button
            type="submit"
            form="reset-request-form"
            aria-disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? "Sending…" : "Send Link"}
          </Button>
        </Field>
      </CardFooter>
    </Card>
  );
}

export function NewPasswordForm({
  token,
  minLength,
}: {
  token: string;
  /** MIN_PASSWORD_LENGTH from the server. */
  minLength: number;
}) {
  const [done, setDone] = React.useState(false);
  const form = useForm<NewPasswordSchemaType>({
    resolver: zodResolver(newPasswordSchema(minLength)),
    values: { password: "", confirm: "" },
  });

  const onSubmit = async (values: NewPasswordSchemaType) => {
    const result = await resetPasswordWithTokenAction({ token, password: values.password });
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
          <h2 className="text-lg font-semibold">Password changed</h2>
          <p role="status">
            Your new password is set, and you have been signed out on every device. Sign in with
            the new password.
          </p>
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

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <h2 className="text-lg font-semibold">Choose a new password</h2>
        <p>Saving it signs you out on every device, including any you have lost.</p>
      </CardHeader>
      <CardContent className="w-full">
        <form id="new-password-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <RootError message={form.formState.errors.root?.message} />
            <Controller
              name="password"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>New password</FieldLabel>
                  <Input
                    id={field.name}
                    type="password"
                    placeholder="Enter a new password"
                    autoComplete="new-password"
                    aria-invalid={fieldState.invalid}
                    aria-describedby="password-hint"
                    {...field}
                  />
                  <FieldDescription id="password-hint">
                    At least {minLength} characters.
                  </FieldDescription>
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <Controller
              name="confirm"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Repeat new password</FieldLabel>
                  <Input
                    id={field.name}
                    type="password"
                    placeholder="Enter it again"
                    autoComplete="new-password"
                    aria-invalid={fieldState.invalid}
                    {...field}
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <Field orientation="horizontal" className="w-full justify-end">
          <Button
            type="submit"
            form="new-password-form"
            aria-disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? "Saving…" : "Save Password"}
          </Button>
        </Field>
      </CardFooter>
    </Card>
  );
}

/** Shown for a link that has expired or was used, and when the site cannot send email. */
export function ResetUnavailable({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p>{children}</p>
      </CardHeader>
      <CardFooter>
        <Field orientation="horizontal" className="w-full justify-end">
          {signInLink}
        </Field>
      </CardFooter>
    </Card>
  );
}
