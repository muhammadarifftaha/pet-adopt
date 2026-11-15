"use client";
import React from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, LoginSchemaType } from "@/lib/zod-schema/auth";
import { signInAction } from "@/server/actions/auth";
import { Field, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card";
import { SiteSetting } from "@/server/types";

export default function LoginForm({ settings }: { settings: SiteSetting }) {
  const form = useForm<LoginSchemaType>({
    resolver: zodResolver(loginSchema),
    values: {
      email: "",
      password: "",
    },
  });

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
        <form id="login-form" onSubmit={form.handleSubmit(signInAction)}>
          <FieldGroup>
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
                    {...field}
                  />
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
                    {...field}
                  />
                </Field>
              )}
            />
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <Field orientation="horizontal" className="w-full justify-end">
          <Button type="submit" form="login-form">
            Sign In
          </Button>
        </Field>
      </CardFooter>
    </Card>
  );
}
