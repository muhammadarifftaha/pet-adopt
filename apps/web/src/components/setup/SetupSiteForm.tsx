"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import React from "react";

import { Button } from "@pet-adopt/ui/components/button";
import { Card, CardContent, CardFooter, CardHeader } from "@pet-adopt/ui/components/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@pet-adopt/ui/components/field";
import { Input } from "@pet-adopt/ui/components/input";
import { updateSettingsAction } from "@/server/actions/settings";
import type { SiteSetting } from "@/server/types";

// Setup step 2: the site's name, tagline and WhatsApp number (everything else is on Site settings).
// The server checks the values as on Site settings.

export function SetupSiteForm({ settings }: { settings: SiteSetting }) {
  const router = useRouter();
  const [values, setValues] = React.useState({ siteName: settings.siteName, tagline: settings.tagline ?? "", whatsappNumber: settings.whatsappNumber ?? "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [key]: event.target.value }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const result = await updateSettingsAction({ siteName: values.siteName, tagline: values.tagline, whatsappNumber: values.whatsappNumber });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.fieldErrors && Object.keys(result.fieldErrors).length ? null : result.error);
        return;
      }
      router.push("/setup?step=theme");
    });
  }

  const field = (key: keyof typeof values, label: string, hint: string, opts: { required?: boolean; type?: string } = {}) => (
    <Field data-invalid={errors[key] ? true : undefined}>
      <FieldLabel htmlFor={`setup-${key}`}>
        {label}
        {opts.required ? <span className="font-normal text-muted-foreground"> (required)</span> : null}
      </FieldLabel>
      <Input id={`setup-${key}`} type={opts.type ?? "text"} value={values[key]} onChange={set(key)} aria-invalid={errors[key] ? true : undefined} aria-describedby={`setup-${key}-hint${errors[key] ? ` setup-${key}-error` : ""}`} />
      <FieldDescription id={`setup-${key}-hint`}>{hint}</FieldDescription>
      {errors[key] ? (
        <p id={`setup-${key}-error`} className="text-sm text-destructive">
          {errors[key]}
        </p>
      ) : null}
    </Field>
  );

  return (
    <Card>
      <CardHeader>
        <h1 className="text-xl font-semibold">Your site</h1>
        <p className="text-sm text-muted-foreground">The basics visitors see. Logo, address, menu and more are on Site settings later.</p>
      </CardHeader>
      <CardContent>
        <form id="setup-site-form" noValidate onSubmit={submit}>
          <FieldGroup>
            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            {field("siteName", "Site name", "Shown at the top of every page and in browser tabs.", { required: true })}
            {field("tagline", "Tagline", "A short line under the name, like “Every pet deserves a loving home”.")}
            {field("whatsappNumber", "WhatsApp number", "Where visitors message you about a pet. With the country code, like +60 12 345 6789.", { type: "tel" })}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex justify-between gap-3">
        <Link href="/setup?step=theme" className="text-sm underline underline-offset-4">
          Skip this step
        </Link>
        <Button type="submit" form="setup-site-form" aria-disabled={pending || undefined}>
          {pending ? "Saving…" : "Save and continue"}
        </Button>
      </CardFooter>
    </Card>
  );
}
