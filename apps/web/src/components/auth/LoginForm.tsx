"use client";
import React from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, LoginSchemaType } from "@/lib/zod-schema/auth";
import { signInAction } from "@/server/actions/auth";
import { verifyTwoFactorAction } from "@/server/actions/two-factor";
import { Checkbox } from "@pet-adopt/ui/components/checkbox";
import { FieldContent } from "@pet-adopt/ui/components/field";
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
  // After a right password, accounts with two-factor on get a second step: the code.
  const [step, setStep] = React.useState<"password" | "code">("password");
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
    if (result.ok && result.data.twoFactor) {
      form.resetField("password");
      setStep("code");
      return;
    }
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

  if (step === "code") {
    return (
      <CodeStep
        siteName={settings.siteName}
        onSignedIn={() => router.replace(redirectTo)}
        onRestart={(message) => {
          setStep("password");
          if (message) form.setError("root", { message });
        }}
      />
    );
  }

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

/**
 * The second step of a sign-in with two-factor on: a code from the authenticator app, or a backup
 * code, in one box. A wrong code stays here; an expired or used-up sign-in goes back to the password.
 */
function CodeStep({
  siteName,
  onSignedIn,
  onRestart,
}: {
  siteName: string;
  onSignedIn: () => void;
  onRestart: (message?: string) => void;
}) {
  const [code, setCode] = React.useState("");
  const [trustDevice, setTrustDevice] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => headingRef.current?.focus(), []);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const result = await verifyTwoFactorAction({ code, trustDevice });
      if (result.ok) return onSignedIn();
      if (result.fieldErrors?.code) return setError(result.fieldErrors.code);
      onRestart(result.error);
    });
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
          Enter your code
        </h2>
        <p>Open your authenticator app and enter the 6-digit code for {siteName}. Lost your phone? Enter one of your backup codes instead.</p>
      </CardHeader>
      <CardContent className="w-full">
        <form id="code-form" noValidate onSubmit={submit}>
          <FieldGroup>
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="two-factor-code">Code</FieldLabel>
              <Input
                id="two-factor-code"
                autoComplete="one-time-code"
                autoCapitalize="none"
                spellCheck={false}
                className="font-mono"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "two-factor-code-error" : undefined}
              />
              {error ? (
                <p id="two-factor-code-error" role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </Field>
            <Field orientation="horizontal">
              <Checkbox id="trust-device" checked={trustDevice} onCheckedChange={(checked) => setTrustDevice(checked === true)} aria-describedby="trust-device-hint" />
              <FieldContent>
                <FieldLabel htmlFor="trust-device">Trust this browser for 30 days</FieldLabel>
                <p id="trust-device-hint" className="text-sm text-muted-foreground">
                  No code on this browser for 30 days. Only on a device you alone use.
                </p>
              </FieldContent>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <Field orientation="horizontal" className="w-full justify-between">
          <Button type="button" variant="ghost" onClick={() => onRestart()}>
            Back
          </Button>
          <Button type="submit" form="code-form" aria-disabled={pending || undefined}>
            {pending ? "Checking…" : "Sign In"}
          </Button>
        </Field>
      </CardFooter>
    </Card>
  );
}
