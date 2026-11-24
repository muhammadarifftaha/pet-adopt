"use client";
import React from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, LoginSchemaType } from "@/lib/zod-schema/auth";
import { signInAction } from "@/server/actions/auth";
import { Field, FieldError, FieldGroup, FieldLabel } from "@pet-adopt/ui/components/field";
import { Input } from "@pet-adopt/ui/components/input";
import { Button } from "@pet-adopt/ui/components/button";
import { Card, CardContent, CardFooter, CardHeader } from "@pet-adopt/ui/components/card";
import { SiteSetting } from "@/server/types";

export default function LoginForm({
  settings,
  redirectTo,
}: {
  settings: SiteSetting;
  /** Already checked on the server (`safeRedirectPath`): a path on this site. */
  redirectTo: string;
}) {
  const router = useRouter();
  const form = useForm<LoginSchemaType>({
    resolver: zodResolver(loginSchema),
    values: {
      email: "",
      password: "",
    },
  });

  // The action sets the session cookie, but the page Next re-renders in the same response still
  // sees the old cookies, so nothing redirects by itself: navigate here once it succeeds. /admin
  // has a different root layout, so this is a full page load that sends the new cookie.
  const onSubmit = async (values: LoginSchemaType) => {
    const result = await signInAction(values);
    if (result.ok) {
      router.replace(redirectTo);
      return;
    }
    for (const [name, message] of Object.entries(result.fieldErrors ?? {})) {
      if (name === "email" || name === "password") form.setError(name, { message });
    }
    form.setError("root", { message: result.error });
  };
  const rootError = form.formState.errors.root?.message;

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <h2 className="text-lg font-semibold">Sign in</h2>
        <p>
          Please enter your email and password to sign in to {settings.siteName}
          .
        </p>
      </CardHeader>
      <CardContent className="w-full">
        <form id="login-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            {rootError && (
              <p role="alert" className="text-sm text-destructive">
                {rootError}
              </p>
            )}
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
            <Controller
              name="password"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                  <Input
                    id={field.name}
                    type="password"
                    placeholder="Enter your password"
                    autoComplete="current-password"
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
            form="login-form"
            aria-disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? "Signing in…" : "Sign In"}
          </Button>
        </Field>
      </CardFooter>
    </Card>
  );
}
