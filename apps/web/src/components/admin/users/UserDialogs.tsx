"use client";

import React from "react";
import { FiCopy, FiEye, FiEyeOff, FiRefreshCw } from "react-icons/fi";

import { Button } from "@pet-adopt/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@pet-adopt/ui/components/dialog";
import { Field, FieldLabel } from "@pet-adopt/ui/components/field";
import { Input } from "@pet-adopt/ui/components/input";
import { RadioGroup, RadioGroupItem } from "@pet-adopt/ui/components/radio-group";
import { asRole, ROLE_INFO } from "@pet-adopt/plugin-sdk";
import { createResetLinkAction } from "@/server/actions/password-reset";
import { createUserAction, resetUserPasswordAction, updateUserAction } from "@/server/actions/users";
import type { InviteResult } from "@/server/invites";
import type { UserListItem } from "@/server/users";

import { InviteOutcome } from "./InviteDialogs";

// The dialogs of the Users screen. Each form lives inside its DialogContent, so it starts fresh
// every time the dialog opens. Forms with several fields show plain error text under each field
// plus one error summary that takes focus (FieldError has role="alert", which would announce
// every field at once).

type Role = UserListItem["role"];
type Failure = { ok: false; error: string; fieldErrors?: Record<string, string> };
type Result<T = unknown> = { ok: true; data: T } | Failure;

/** What a dialog tells the screen after it succeeds: the message for the status line. */
export type Done = (message: string) => void;

// The order people usually pick from: the everyday role first, full access last.
const ROLE_CHOICES = (["editor", "developer", "audit", "admin"] as const).map((value) => ({ value, ...ROLE_INFO[value] }));

const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** A strong password from the browser's random generator: 20 characters, no look-alikes. */
function generatePassword(length = 20) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
}

// --- Shared form parts ------------------------------------------------------------------------

function useFormErrors() {
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const summaryRef = React.useRef<HTMLDivElement>(null);
  const show = (failure: Failure) => {
    setFieldErrors(failure.fieldErrors ?? {});
    setFormError(failure.error);
    requestAnimationFrame(() => summaryRef.current?.focus());
  };
  const clear = () => {
    setFieldErrors({});
    setFormError(null);
  };
  return { fieldErrors, formError, summaryRef, show, clear };
}

/** The message at the top of a form: a list of links to the fields, or the server's message. */
function ErrorSummary({
  errors,
  formError,
  labels,
  idFor,
  summaryRef,
}: {
  errors: Record<string, string>;
  formError: string | null;
  labels: Record<string, string>;
  idFor: (key: string) => string;
  summaryRef: React.RefObject<HTMLDivElement | null>;
}) {
  if (!formError) return null;
  const listed = Object.keys(labels).filter((key) => errors[key]);
  return (
    <div ref={summaryRef} role="alert" tabIndex={-1} className="rounded-md border border-destructive p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <p className="font-medium text-destructive">{listed.length ? "Please check these:" : formError}</p>
      {listed.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {listed.map((key) => (
            <li key={key}>
              <a href={`#${idFor(key)}`} className="underline underline-offset-4">
                {labels[key]}: {errors[key]}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TextField({
  id,
  label,
  error,
  hint,
  required,
  ...input
}: { id: string; label: string; error?: string; hint?: string; required?: boolean } & React.ComponentProps<"input">) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>
        {label}
        {required ? <span className="font-normal text-muted-foreground"> (required)</span> : null}
      </FieldLabel>
      <Input id={id} aria-describedby={describedBy} aria-invalid={error ? true : undefined} aria-required={required || undefined} {...input} />
      {hint ? <p id={`${id}-hint`} className="text-sm text-muted-foreground">{hint}</p> : null}
      {error ? <p id={`${id}-error`} className="text-sm text-destructive">{error}</p> : null}
    </Field>
  );
}

/** Password with Show and Generate. A generated password is shown, so it can be copied and shared. */
function PasswordField({
  id,
  label,
  value,
  onChange,
  error,
  minLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  minLength: number;
}) {
  const [visible, setVisible] = React.useState(false);
  const [note, setNote] = React.useState("");
  const describedBy = [`${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ");
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>
        {label}
        <span className="font-normal text-muted-foreground"> (required)</span>
      </FieldLabel>
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          aria-required
          className="min-w-0 flex-1 basis-48 font-mono"
          maxLength={128}
        />
        <Button type="button" variant="outline" aria-pressed={visible} onClick={() => setVisible((v) => !v)}>
          {visible ? <FiEyeOff aria-hidden /> : <FiEye aria-hidden />}
          {visible ? "Hide" : "Show"}
          <span className="sr-only">password</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onChange(generatePassword());
            setVisible(true);
            setNote("A new password was generated and is shown in the field.");
          }}
        >
          <FiRefreshCw aria-hidden />
          Generate
          <span className="sr-only">a strong password</span>
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        At least {minLength} characters. Share it with them privately; they can change it on their Account page.
      </p>
      {error ? <p id={`${id}-error`} className="text-sm text-destructive">{error}</p> : null}
      <p aria-live="polite" className="sr-only">{note}</p>
    </Field>
  );
}

function RoleField({
  idPrefix,
  value,
  onChange,
  error,
  warning,
}: {
  idPrefix: string;
  value: Role;
  onChange: (role: Role) => void;
  error?: string;
  warning?: string | null;
}) {
  const legendId = `${idPrefix}-role-legend`;
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={[warning && `${idPrefix}-role-warning`, error && `${idPrefix}-role-error`].filter(Boolean).join(" ") || undefined}>
      <legend id={legendId} className="mb-1 text-sm font-medium">
        Role
      </legend>
      <RadioGroup id={`${idPrefix}-role`} aria-labelledby={legendId} value={value} onValueChange={(next) => onChange(asRole(next))}>
        {ROLE_CHOICES.map((choice) => {
          const id = `${idPrefix}-role-${choice.value}`;
          return (
            <Field orientation="horizontal" key={choice.value} className="w-fit items-start">
              <RadioGroupItem id={id} value={choice.value} aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`} className="mt-0.5 cursor-pointer" />
              <span className="flex flex-col">
                <FieldLabel id={`${id}-label`} htmlFor={id} className="cursor-pointer">
                  {choice.label}
                </FieldLabel>
                <span id={`${id}-description`} className="text-sm text-muted-foreground">
                  {choice.description}
                </span>
              </span>
            </Field>
          );
        })}
      </RadioGroup>
      {warning ? (
        <p id={`${idPrefix}-role-warning`} className="rounded-md bg-muted p-2 text-sm">
          {warning}
        </p>
      ) : null}
      {error ? <p id={`${idPrefix}-role-error`} className="text-sm text-destructive">{error}</p> : null}
    </fieldset>
  );
}

/** A submit button that stays focusable while busy (aria-disabled, not disabled). */
function SubmitButton({ pending, children, busyText }: { pending: boolean; children: React.ReactNode; busyText: string }) {
  return (
    <Button type="submit" aria-disabled={pending || undefined}>
      {pending ? busyText : children}
    </Button>
  );
}

// --- Add user ---------------------------------------------------------------------------------

export function AddUserDialog({ minPasswordLength, onDone }: { minPasswordLength: number; onDone: Done }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>Add user</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <AddUserForm
          minPasswordLength={minPasswordLength}
          onDone={(message) => {
            setOpen(false);
            onDone(message);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function AddUserForm({ minPasswordLength, onDone }: { minPasswordLength: number; onDone: Done }) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<Role>("editor");
  // An email invite by default (agreed with the owner): they choose their own password.
  const [method, setMethod] = React.useState<"invite" | "password">("invite");
  const [password, setPassword] = React.useState("");
  // An invite that was not emailed: the link stays on screen to copy.
  const [unsent, setUnsent] = React.useState<{ invite: InviteResult; name: string; email: string } | null>(null);
  const [pending, startTransition] = React.useTransition();
  const errors = useFormErrors();
  const id = (key: string) => (key === "role" ? "add-user-role-editor" : `add-user-${key}`);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const input = method === "invite" ? { name, email, role, invite: true } : { name, email, role, password };
      const result = (await createUserAction(input)) as Result<{ id: string; invite: InviteResult | null }>;
      if (!result.ok) return errors.show(result);
      errors.clear();
      const added = `${name.trim()} was added with the ${ROLE_INFO[role].label} role.`;
      const invite = result.data.invite;
      if (invite && !invite.sent) return setUnsent({ invite, name: name.trim(), email: email.trim() });
      onDone(invite ? `${added} An invite was emailed to ${email.trim()}.` : `${added} Share the password with them privately.`);
    });
  }

  if (unsent) {
    return (
      <div className="flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{unsent.name} was added</DialogTitle>
          <DialogDescription>Their account is ready; it has no password until they open the invite link.</DialogDescription>
        </DialogHeader>
        <InviteOutcome invite={unsent.invite} user={unsent} />
        <DialogFooter>
          <Button type="button" onClick={() => onDone(`${unsent.name} was added. Send them the invite link.`)}>
            Done
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Add user</DialogTitle>
        <DialogDescription>They sign in at /admin/login with this email and their password.</DialogDescription>
      </DialogHeader>
      <ErrorSummary
        errors={errors.fieldErrors}
        formError={errors.formError}
        labels={{ name: "Name", email: "Email", role: "Role", password: "Password" }}
        idFor={id}
        summaryRef={errors.summaryRef}
      />
      <TextField id="add-user-name" label="Name" required autoComplete="off" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} error={errors.fieldErrors.name} />
      <TextField
        id="add-user-email"
        label="Email"
        type="email"
        required
        autoComplete="off"
        maxLength={200}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.fieldErrors.email}
      />
      <RoleField idPrefix="add-user" value={role} onChange={setRole} error={errors.fieldErrors.role} />
      <fieldset className="flex flex-col gap-2">
        <legend id="add-user-method-legend" className="mb-1 text-sm font-medium">
          Their password
        </legend>
        <RadioGroup aria-labelledby="add-user-method-legend" value={method} onValueChange={(next) => setMethod(next === "password" ? "password" : "invite")}>
          <Field orientation="horizontal" className="w-fit items-start">
            <RadioGroupItem id="add-user-method-invite" value="invite" aria-describedby="add-user-method-invite-description" className="mt-0.5 cursor-pointer" />
            <span className="flex flex-col">
              <FieldLabel htmlFor="add-user-method-invite" className="cursor-pointer">
                Email an invite
              </FieldLabel>
              <span id="add-user-method-invite-description" className="text-sm text-muted-foreground">
                They get a link to choose their own password, valid for 7 days.
              </span>
            </span>
          </Field>
          <Field orientation="horizontal" className="w-fit items-start">
            <RadioGroupItem id="add-user-method-password" value="password" aria-describedby="add-user-method-password-description" className="mt-0.5 cursor-pointer" />
            <span className="flex flex-col">
              <FieldLabel htmlFor="add-user-method-password" className="cursor-pointer">
                Set a password now
              </FieldLabel>
              <span id="add-user-method-password-description" className="text-sm text-muted-foreground">
                You share it with them yourself.
              </span>
            </span>
          </Field>
        </RadioGroup>
      </fieldset>
      {method === "password" ? (
        <PasswordField id="add-user-password" label="Password" value={password} onChange={setPassword} error={errors.fieldErrors.password} minLength={minPasswordLength} />
      ) : null}
      <DialogFooter>
        <SubmitButton pending={pending} busyText={method === "invite" ? "Inviting…" : "Adding…"}>
          {method === "invite" ? "Add and invite" : "Add user"}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

// --- Edit name and role -----------------------------------------------------------------------

export function EditUserDialog({ user, isMe, onDone }: { user: UserListItem; isMe: boolean; onDone: Done }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Edit
        <span className="sr-only">{user.name}</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <EditUserForm
          user={user}
          isMe={isMe}
          onDone={(message) => {
            setOpen(false);
            onDone(message);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function EditUserForm({ user, isMe, onDone }: { user: UserListItem; isMe: boolean; onDone: Done }) {
  const [name, setName] = React.useState(user.name);
  const [role, setRole] = React.useState<Role>(user.role);
  const [email, setEmail] = React.useState(user.email);
  const [pending, startTransition] = React.useTransition();
  const errors = useFormErrors();
  const prefix = `edit-user-${user.id}`;
  const id = (key: string) => (key === "role" ? `${prefix}-role-${role}` : `${prefix}-${key}`);
  const demotingMe = isMe && user.role === "admin" && role !== "admin";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const result = (await updateUserAction(user.id, { name, role, email })) as Result;
      if (!result.ok) return errors.show(result);
      const movedEmail = email.trim().toLowerCase() !== user.email;
      onDone(movedEmail ? `${name.trim()} was updated. Both email addresses were told about the change.` : `${name.trim()} was updated.`);
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Edit {user.name}</DialogTitle>
        <DialogDescription>{user.email}</DialogDescription>
      </DialogHeader>
      <ErrorSummary errors={errors.fieldErrors} formError={errors.formError} labels={{ name: "Name", email: "Email", role: "Role" }} idFor={id} summaryRef={errors.summaryRef} />
      <TextField id={`${prefix}-name`} label="Name" required autoComplete="off" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} error={errors.fieldErrors.name} />
      <TextField
        id={`${prefix}-email`}
        label="Email"
        type="email"
        required
        autoComplete="off"
        maxLength={200}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.fieldErrors.email}
        hint="They sign in with it. A change takes effect at once, and both the old and the new address get a notice."
      />
      <RoleField
        idPrefix={prefix}
        value={role}
        onChange={setRole}
        error={errors.fieldErrors.role}
        warning={demotingMe ? `This is your own account: with the ${ROLE_INFO[role].label} role you will no longer be able to manage users as soon as you save.` : null}
      />
      <DialogFooter>
        <SubmitButton pending={pending} busyText="Saving…">
          Save changes
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

// --- New password -----------------------------------------------------------------------------

export function PasswordDialog({ user, isMe, minPasswordLength, onDone }: { user: UserListItem; isMe: boolean; minPasswordLength: number; onDone: Done }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        New password
        <span className="sr-only">for {user.name}</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <PasswordForm
          user={user}
          isMe={isMe}
          minPasswordLength={minPasswordLength}
          onDone={(message) => {
            setOpen(false);
            onDone(message);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function PasswordForm({ user, isMe, minPasswordLength, onDone }: { user: UserListItem; isMe: boolean; minPasswordLength: number; onDone: Done }) {
  const [password, setPassword] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const errors = useFormErrors();
  const id = `password-${user.id}`;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const result = (await resetUserPasswordAction(user.id, { password })) as Result;
      if (!result.ok) return errors.show(result);
      onDone(`${user.name} has a new password and was signed out everywhere.`);
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>New password for {user.name}</DialogTitle>
        <DialogDescription>
          {isMe
            ? "This is your own account: you will be signed out everywhere, including here, and sign in again with the new password. Your Account page changes it without signing you out here."
            : "They are signed out everywhere and sign in again with the new password. To let them choose their own instead, use Reset link."}
        </DialogDescription>
      </DialogHeader>
      <ErrorSummary errors={errors.fieldErrors} formError={errors.formError} labels={{ password: "Password" }} idFor={() => id} summaryRef={errors.summaryRef} />
      <PasswordField id={id} label="New password" value={password} onChange={setPassword} error={errors.fieldErrors.password} minLength={minPasswordLength} />
      <DialogFooter>
        <SubmitButton pending={pending} busyText="Saving…">
          Set password
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

// --- Reset link -------------------------------------------------------------------------------

export function ResetLinkDialog({ user, onDone }: { user: UserListItem; onDone: Done }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Reset link
        <span className="sr-only">for {user.name}</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <ResetLinkPanel user={user} onDone={onDone} />
      </DialogContent>
    </Dialog>
  );
}

function ResetLinkPanel({ user, onDone }: { user: UserListItem; onDone: Done }) {
  const [link, setLink] = React.useState<{ url: string; expiresAt: Date } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copyNote, setCopyNote] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const id = `reset-link-${user.id}`;

  function create() {
    if (pending) return;
    startTransition(async () => {
      const result = (await createResetLinkAction(user.id)) as Result<{ url: string; expiresAt: Date }>;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setCopyNote("");
      setLink({ url: result.data.url, expiresAt: new Date(result.data.expiresAt) });
      onDone(`A reset link for ${user.name} was created.`);
      requestAnimationFrame(() => inputRef.current?.select());
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopyNote("Link copied.");
    } catch {
      inputRef.current?.select();
      setCopyNote("Could not copy automatically: the link is selected, copy it with Ctrl+C (Cmd+C on a Mac).");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Reset link for {user.name}</DialogTitle>
        <DialogDescription>
          A one-time link where they choose a new password themselves. Send it however you like. It works once, for one hour, and making a new link cancels
          older ones.
        </DialogDescription>
      </DialogHeader>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {link ? (
        <Field>
          <FieldLabel htmlFor={id}>Reset link</FieldLabel>
          <div className="flex flex-wrap gap-2">
            <Input id={id} ref={inputRef} readOnly value={link.url} aria-describedby={`${id}-expiry`} className="min-w-0 flex-1 basis-56 font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button type="button" variant="outline" onClick={copy}>
              <FiCopy aria-hidden />
              Copy
              <span className="sr-only">link</span>
            </Button>
          </div>
          <p id={`${id}-expiry`} className="text-sm text-muted-foreground">
            Expires {when.format(link.expiresAt)}.
          </p>
          <p aria-live="polite" className="text-sm">
            {copyNote}
          </p>
        </Field>
      ) : null}
      <DialogFooter>
        <Button type="button" variant={link ? "outline" : "default"} aria-disabled={pending || undefined} onClick={create}>
          {pending ? "Creating…" : link ? "Make a new link" : "Create link"}
        </Button>
      </DialogFooter>
    </div>
  );
}
