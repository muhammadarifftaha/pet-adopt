"use client";

import { useRouter } from "next/navigation";
import React from "react";
import { FiCopy, FiEdit2, FiPlus, FiTrash2 } from "react-icons/fi";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@pet-adopt/ui/components/alert-dialog";
import { Badge } from "@pet-adopt/ui/components/badge";
import { Button } from "@pet-adopt/ui/components/button";
import { Checkbox } from "@pet-adopt/ui/components/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@pet-adopt/ui/components/dialog";
import { Field, FieldContent, FieldLabel } from "@pet-adopt/ui/components/field";
import { Input } from "@pet-adopt/ui/components/input";
import { RadioGroup, RadioGroupItem } from "@pet-adopt/ui/components/radio-group";
import { useViewOnly } from "@/components/admin/view-only";
import { deleteAuthProviderAction, saveAuthProviderAction } from "@/server/actions/auth-providers";
import type { AuthProviderView, ProviderKind } from "@/server/auth-providers";

// Authentication > Sign-in providers: "bring your own" OAuth 2 / OpenID Connect. Admins add, change
// and delete providers; audit views them. People connect a provider to their own account on the
// Account page before it signs them in (it never creates or matches accounts by email).

type Announce = (message: string, isError?: boolean) => void;
type Failure = { ok: false; error: string; fieldErrors?: Record<string, string> };

const DEFAULT_SCOPES: Record<ProviderKind, string> = { oidc: "openid email profile", oauth2: "email profile" };

export function AuthProviders({ providers }: { providers: AuthProviderView[] }) {
  const router = useRouter();
  const viewOnly = useViewOnly();
  const [message, setMessage] = React.useState<{ text: string; isError: boolean; id: number } | null>(null);
  const messageRef = React.useRef<HTMLDivElement>(null);
  const announce = React.useCallback<Announce>(
    (text, isError = false) => setMessage((previous) => ({ text, isError, id: (previous?.id ?? 0) + 1 })),
    [],
  );
  const done = (text: string) => {
    announce(text);
    router.refresh();
  };

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Let people sign in with an outside account (Google Workspace, Microsoft Entra, Okta, Keycloak or any OpenID Connect or OAuth 2 service). A
        provider signs someone in only after they connect it on their Account page; it never creates accounts. It counts as two-factor.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto text-sm">
          {providers.length} {providers.length === 1 ? "provider" : "providers"}
        </p>
        {viewOnly ? null : <ProviderDialog onDone={done} />}
      </div>
      <div ref={messageRef} tabIndex={-1} aria-live="polite" className="min-h-6 text-sm outline-none">
        {message && !message.isError ? <p key={message.id}>{message.text}</p> : null}
      </div>
      {message?.isError ? (
        <p key={message.id} role="alert" className="text-sm text-destructive">
          {message.text}
        </p>
      ) : null}
      {providers.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No sign-in providers yet.</p>
      ) : (
        <ul aria-label="Sign-in providers" className="flex flex-col divide-y rounded-lg border">
          {providers.map((provider) => (
            <li key={provider.id} className="flex flex-col gap-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-auto flex flex-wrap items-center gap-2">
                  <span className="font-medium">{provider.name}</span>
                  {provider.enabled ? <Badge>On</Badge> : <Badge variant="outline">Off</Badge>}
                  <Badge variant="secondary">{provider.kind === "oidc" ? "OpenID Connect" : "OAuth 2"}</Badge>
                </span>
                {viewOnly ? null : (
                  <span className="flex flex-wrap gap-2">
                    <ProviderDialog provider={provider} onDone={done} />
                    <DeleteProvider provider={provider} announce={announce} onDone={done} />
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {provider.connected} {provider.connected === 1 ? "account" : "accounts"} connected · client ID {provider.clientId}
              </p>
              <RedirectUri uri={provider.redirectUri} name={provider.name} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The callback address to register at the provider, with Copy. */
function RedirectUri({ uri, name }: { uri: string; name: string }) {
  const [note, setNote] = React.useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(uri);
      setNote("Copied.");
    } catch {
      setNote("Could not copy automatically: select the address and copy it.");
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>Redirect URI to register at the provider:</span>
      <code className="rounded bg-muted px-1.5 py-0.5 break-all select-all">{uri}</code>
      <Button type="button" variant="ghost" size="sm" onClick={copy}>
        <FiCopy aria-hidden />
        Copy
        <span className="sr-only">the redirect URI for {name}</span>
      </Button>
      <span aria-live="polite">{note}</span>
    </div>
  );
}

function ProviderDialog({ provider, onDone }: { provider?: AuthProviderView; onDone: (message: string) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant={provider ? "outline" : "default"} size={provider ? "sm" : "default"} />}>
        {provider ? <FiEdit2 aria-hidden /> : <FiPlus aria-hidden />}
        {provider ? "Edit" : "Add provider"}
        {provider ? <span className="sr-only">{provider.name}</span> : null}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <ProviderForm
          provider={provider}
          onSaved={(text) => {
            setOpen(false);
            onDone(text);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ProviderForm({ provider, onSaved }: { provider?: AuthProviderView; onSaved: (message: string) => void }) {
  const [kind, setKind] = React.useState<ProviderKind>(provider?.kind ?? "oidc");
  const [values, setValues] = React.useState({
    name: provider?.name ?? "",
    discoveryUrl: provider?.discoveryUrl ?? "",
    authorizationUrl: provider?.authorizationUrl ?? "",
    tokenUrl: provider?.tokenUrl ?? "",
    userInfoUrl: provider?.userInfoUrl ?? "",
    clientId: provider?.clientId ?? "",
    clientSecret: "",
    scopes: provider?.scopes ?? DEFAULT_SCOPES.oidc,
  });
  const [enabled, setEnabled] = React.useState(provider?.enabled ?? true);
  const [clearSecret, setClearSecret] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const summaryRef = React.useRef<HTMLParagraphElement>(null);
  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [key]: event.target.value }));

  function changeKind(next: ProviderKind) {
    // Keep typed scopes; swap only the untouched defaults.
    setValues((v) => (v.scopes === DEFAULT_SCOPES[kind] ? { ...v, scopes: DEFAULT_SCOPES[next] } : v));
    setKind(next);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const input = {
        name: values.name,
        kind,
        ...(kind === "oidc"
          ? { discoveryUrl: values.discoveryUrl }
          : { authorizationUrl: values.authorizationUrl, tokenUrl: values.tokenUrl, userInfoUrl: values.userInfoUrl }),
        clientId: values.clientId,
        clientSecret: values.clientSecret,
        clearSecret,
        scopes: values.scopes,
        enabled,
      };
      const result = await saveAuthProviderAction(provider?.id ?? null, input);
      if (!result.ok) {
        const failure = result as Failure;
        setErrors(failure.fieldErrors ?? {});
        setFormError(failure.error);
        requestAnimationFrame(() => summaryRef.current?.focus());
        return;
      }
      onSaved(
        provider
          ? `${result.data.name} was saved.`
          : `${result.data.name} was added. Register ${result.data.redirectUri} as its redirect URI at the provider.`,
      );
    });
  }

  const text = (key: keyof typeof values, label: string, opts: { hint?: string; type?: string; placeholder?: string; required?: boolean } = {}) => {
    const id = `provider-${key}`;
    const error = errors[key];
    const describedBy = [opts.hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
    return (
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={id}>
          {label}
          {opts.required ? <span className="font-normal text-muted-foreground"> (required)</span> : null}
        </FieldLabel>
        <Input
          id={id}
          type={opts.type ?? "text"}
          value={values[key]}
          onChange={set(key)}
          placeholder={opts.placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        {opts.hint ? (
          <p id={`${id}-hint`} className="text-sm text-muted-foreground">
            {opts.hint}
          </p>
        ) : null}
        {error ? (
          <p id={`${id}-error`} className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </Field>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{provider ? `Edit ${provider.name}` : "Add a sign-in provider"}</DialogTitle>
        <DialogDescription>
          {provider
            ? `Its address here stays /api/auth/callback/${provider.slug}.`
            : "Create an app (client) at the provider first. After saving, register the redirect URI shown in the list."}
        </DialogDescription>
      </DialogHeader>
      {formError ? (
        <p ref={summaryRef} tabIndex={-1} role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive outline-none">
          {Object.keys(errors).length ? "Please check the highlighted fields." : formError}
        </p>
      ) : null}
      {text("name", "Name on the button", { required: true, placeholder: "Google Workspace", hint: "People see “Sign in with <name>”." })}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Type</legend>
        <RadioGroup value={kind} onValueChange={(value) => changeKind(value as ProviderKind)}>
          <Field orientation="horizontal">
            <RadioGroupItem value="oidc" id="provider-kind-oidc" />
            <FieldLabel htmlFor="provider-kind-oidc">OpenID Connect (most providers: one discovery URL)</FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <RadioGroupItem value="oauth2" id="provider-kind-oauth2" />
            <FieldLabel htmlFor="provider-kind-oauth2">OAuth 2 (enter the endpoints by hand)</FieldLabel>
          </Field>
        </RadioGroup>
      </fieldset>
      {kind === "oidc" ? (
        text("discoveryUrl", "Discovery URL", {
          required: true,
          placeholder: "https://accounts.example.com/.well-known/openid-configuration",
          hint: "Usually ends in /.well-known/openid-configuration.",
        })
      ) : (
        <>
          {text("authorizationUrl", "Authorization URL", { required: true })}
          {text("tokenUrl", "Token URL", { required: true })}
          {text("userInfoUrl", "User info URL", { required: true, hint: "Must return the person's id and email." })}
        </>
      )}
      {text("clientId", "Client ID", { required: true })}
      {text("clientSecret", "Client secret", {
        type: "password",
        hint: provider?.secretSet ? "A secret is saved. Leave blank to keep it." : "Stored encrypted. Leave blank for a public client (PKCE only).",
      })}
      {provider?.secretSet ? (
        <Field orientation="horizontal">
          <Checkbox id="provider-clear-secret" checked={clearSecret} onCheckedChange={(checked) => setClearSecret(checked === true)} />
          <FieldLabel htmlFor="provider-clear-secret">Remove the saved secret</FieldLabel>
        </Field>
      ) : null}
      {text("scopes", "Scopes", { hint: "Separated by spaces. The provider must return an email." })}
      <Field orientation="horizontal">
        <Checkbox id="provider-enabled" checked={enabled} onCheckedChange={(checked) => setEnabled(checked === true)} />
        <FieldContent>
          <FieldLabel htmlFor="provider-enabled">On</FieldLabel>
          <p className="text-sm text-muted-foreground">Shown on the sign-in and Account pages.</p>
        </FieldContent>
      </Field>
      <DialogFooter>
        <Button type="submit" aria-disabled={pending || undefined}>
          {pending ? "Saving…" : provider ? "Save" : "Add provider"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function DeleteProvider({ provider, announce, onDone }: { provider: AuthProviderView; announce: Announce; onDone: (message: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function remove() {
    if (pending) return;
    startTransition(async () => {
      const result = await deleteAuthProviderAction(provider.id);
      setOpen(false);
      if (result.ok) onDone(`${provider.name} was deleted.`);
      else announce(result.error, true);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="destructive" size="sm" aria-disabled={pending || undefined} />}>
        <FiTrash2 aria-hidden />
        Delete
        <span className="sr-only">{provider.name}</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {provider.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {provider.connected
              ? `${provider.connected} ${provider.connected === 1 ? "account is" : "accounts are"} connected to it and will be disconnected. `
              : ""}
            People keep their passwords. To stop it for a while instead, edit it and turn it off.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep</AlertDialogCancel>
          <Button variant="destructive" aria-disabled={pending || undefined} onClick={remove}>
            {pending ? "Deleting…" : "Delete provider"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
