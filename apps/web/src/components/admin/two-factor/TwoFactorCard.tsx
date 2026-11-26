"use client";

import { useRouter } from "next/navigation";
import React from "react";

import { Badge } from "@pet-adopt/ui/components/badge";
import { Button } from "@pet-adopt/ui/components/button";
import { Card, CardContent, CardHeader } from "@pet-adopt/ui/components/card";
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
import { disableTwoFactorAction, regenerateBackupCodesAction, type TwoFactorStatus } from "@/server/actions/two-factor";

import { BackupCodeList } from "./BackupCodeList";
import { TwoFactorSetup } from "./TwoFactorSetup";

// Two-factor sign-in on the Account page: set it up, make new backup codes, or turn it off (not
// while the person's role requires it). Every change asks for the password again.

const FEW_CODES = 3;

export function TwoFactorCard({ status, siteName }: { status: TwoFactorStatus; siteName: string }) {
  const router = useRouter();
  const [settingUp, setSettingUp] = React.useState(false);
  const [message, setMessage] = React.useState<{ text: string; id: number } | null>(null);
  const announce = (text: string) => setMessage((previous) => ({ text, id: (previous?.id ?? 0) + 1 }));

  const left = status.backupCodesLeft;
  return (
    <Card>
      <CardHeader>
        <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
          Two-factor sign-in
          {status.enabled ? <Badge>On</Badge> : <Badge variant="outline">Off</Badge>}
          {status.required ? <Badge variant="secondary">Required for your role</Badge> : null}
        </h2>
        <p className="text-sm text-muted-foreground">
          After your password, you also enter a code from an authenticator app on your phone, so a stolen password alone cannot open your account.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p aria-live="polite" className="text-sm empty:hidden">
          {message ? <span key={message.id}>{message.text}</span> : null}
        </p>
        {!status.enabled && !settingUp ? (
          <div>
            <Button type="button" onClick={() => setSettingUp(true)}>
              Set up two-factor
            </Button>
          </div>
        ) : null}
        {settingUp ? (
          <TwoFactorSetup
            siteName={siteName}
            onCancel={() => setSettingUp(false)}
            onDone={() => {
              setSettingUp(false);
              announce("Two-factor sign-in is on.");
              router.refresh();
            }}
          />
        ) : null}
        {status.enabled && !settingUp ? (
          <>
            {left !== null ? (
              <p className={`text-sm ${left <= FEW_CODES ? "text-destructive" : ""}`}>
                {left} of 10 backup codes left.{left <= FEW_CODES ? " Make new ones soon." : null}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <NewCodesDialog siteName={siteName} onDone={() => router.refresh()} />
              {status.required ? null : (
                <TurnOffDialog
                  onDone={() => {
                    announce("Two-factor sign-in is off.");
                    router.refresh();
                  }}
                />
              )}
            </div>
            {status.required ? (
              <p className="text-sm text-muted-foreground">Your role must use two-factor, so it cannot be turned off. An admin can reset it if you lose your phone.</p>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** A password box for the dialogs below. */
function PasswordBox({ id, value, onChange, error }: { id: string; value: string; onChange: (value: string) => void; error?: string }) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>Your password</FieldLabel>
      <Input
        id={id}
        type="password"
        autoComplete="current-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Field>
  );
}

function NewCodesDialog({ siteName, onDone }: { siteName: string; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string>();
  const [codes, setCodes] = React.useState<string[] | null>(null);
  const [pending, startTransition] = React.useTransition();

  function change(next: boolean) {
    setOpen(next);
    if (!next) {
      if (codes) onDone();
      setPassword("");
      setError(undefined);
      setCodes(null);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const result = await regenerateBackupCodesAction({ password });
      if (!result.ok) return setError(result.fieldErrors?.password ?? result.error);
      setPassword("");
      setError(undefined);
      setCodes(result.data.backupCodes);
    });
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger render={<Button type="button" variant="outline" />}>New backup codes</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New backup codes</DialogTitle>
          <DialogDescription>{codes ? "Your old codes no longer work. Save these; they are not shown again." : "Ten new codes. Your old codes stop working."}</DialogDescription>
        </DialogHeader>
        {codes ? (
          <>
            <BackupCodeList codes={codes} siteName={siteName} />
            <DialogFooter>
              <Button type="button" onClick={() => change(false)}>
                I have saved my codes
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <PasswordBox id="codes-password" value={password} onChange={setPassword} error={error} />
            <DialogFooter>
              <Button type="submit" aria-disabled={pending || undefined}>
                {pending ? "Making codes…" : "Make new codes"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TurnOffDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();

  function change(next: boolean) {
    setOpen(next);
    if (!next) {
      setPassword("");
      setError(undefined);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const result = await disableTwoFactorAction({ password });
      if (!result.ok) return setError(result.fieldErrors?.password ?? result.error);
      change(false);
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger render={<Button type="button" variant="outline" />}>Turn off</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Turn off two-factor sign-in?</DialogTitle>
          <DialogDescription>Your password alone will open your account again. Your backup codes stop working, and trusted browsers are forgotten.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <PasswordBox id="off-password" value={password} onChange={setPassword} error={error} />
          <DialogFooter>
            <Button type="submit" variant="destructive" aria-disabled={pending || undefined}>
              {pending ? "Turning off…" : "Turn off two-factor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
