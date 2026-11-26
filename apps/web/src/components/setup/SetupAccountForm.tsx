"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import React from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@pet-adopt/ui/components/button";
import { Card, CardContent, CardFooter, CardHeader } from "@pet-adopt/ui/components/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@pet-adopt/ui/components/field";
import { Input } from "@pet-adopt/ui/components/input";
import { createFirstAdminAction } from "@/server/actions/setup";

// Setup step 1: the first admin account, with the key from the setup link (src/server/setup.ts).
// On success they are signed in and go on to the site's basics.

const schemaFor = (minLength: number) =>
  z
    .object({
      name: z.string().trim().min(1, "Enter your name").max(80, "Use at most 80 characters"),
      email: z.email("Enter a valid email address"),
      password: z.string().min(minLength, `Use at least ${minLength} characters`).max(128, "Use at most 128 characters"),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The passwords do not match" });
type Values = z.infer<ReturnType<typeof schemaFor>>;

export function SetupAccountForm({ setupKey, minPasswordLength }: { setupKey: string; minPasswordLength: number }) {
  const router = useRouter();
  const form = useForm<Values>({ resolver: zodResolver(schemaFor(minPasswordLength)), defaultValues: { name: "", email: "", password: "", confirm: "" } });

  const onSubmit = async (values: Values) => {
    const result = await createFirstAdminAction({ key: setupKey, name: values.name, email: values.email, password: values.password });
    if (result.ok) {
      router.replace("/setup?step=site");
      router.refresh();
      return;
    }
    let placed = false;
    for (const [name, message] of Object.entries(result.fieldErrors ?? {})) {
      if (name === "name" || name === "email" || name === "password") {
        form.setError(name, { message });
        placed = true;
      }
    }
    if (!placed) form.setError("root", { message: result.error });
  };

  const text = (name: "name" | "email" | "password" | "confirm", label: string, type: string, autoComplete: string, hint?: string) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`setup-${name}`}>{label}</FieldLabel>
          <Input id={`setup-${name}`} type={type} autoComplete={autoComplete} aria-invalid={fieldState.invalid} aria-describedby={hint ? `setup-${name}-hint` : undefined} {...field} />
          {hint ? <FieldDescription id={`setup-${name}-hint`}>{hint}</FieldDescription> : null}
          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );

  return (
    <Card>
      <CardHeader>
        <h1 className="text-xl font-semibold">Create your admin account</h1>
        <p className="text-sm text-muted-foreground">This is the first account of the site. It can do everything, including adding other people later.</p>
      </CardHeader>
      <CardContent>
        <form id="setup-account-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            {form.formState.errors.root?.message ? (
              <p role="alert" className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            ) : null}
            {text("name", "Your name", "text", "name")}
            {text("email", "Email", "email", "username", "You sign in with it. Reset links go there.")}
            {text("password", "Password", "password", "new-password", `At least ${minPasswordLength} characters.`)}
            {text("confirm", "Repeat password", "password", "new-password")}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="justify-end">
        <Button type="submit" form="setup-account-form" aria-disabled={form.formState.isSubmitting || undefined}>
          {form.formState.isSubmitting ? "Creating…" : "Create account"}
        </Button>
      </CardFooter>
    </Card>
  );
}
