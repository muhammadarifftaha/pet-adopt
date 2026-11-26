"use client";

import { useRouter } from "next/navigation";
import React from "react";
import Cropper, { type Area } from "react-easy-crop";
import { FiTrash2, FiUpload } from "react-icons/fi";

import { Button } from "@pet-adopt/ui/components/button";
import { Card, CardContent, CardHeader } from "@pet-adopt/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@pet-adopt/ui/components/dialog";
import { Label } from "@pet-adopt/ui/components/label";
import { UserAvatar } from "@/components/admin/UserAvatar";
import { removeAvatarAction, uploadAvatarAction } from "@/server/actions/auth";
import type { SessionUser } from "@/server/types";

// The Account page's profile picture: choose a photo, pick the square to keep (drag, zoom with the
// slider or the arrow keys), save. The server keeps only that square at 256 px
// (src/server/avatars.ts). Remove goes back to the initials.

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const MAX_BYTES = 10_000_000;

export function ProfilePicture({ user }: { user: SessionUser }) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [picked, setPicked] = React.useState<{ file: File; url: string } | null>(null);
  const [crop, setCrop] = React.useState({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [area, setArea] = React.useState<Area | null>(null);
  const [natural, setNatural] = React.useState<{ width: number; height: number } | null>(null);
  const [message, setMessage] = React.useState<{ text: string; isError: boolean } | null>(null);
  const [pending, startTransition] = React.useTransition();

  // The object URL lives as long as the dialog shows it.
  React.useEffect(() => () => (picked ? URL.revokeObjectURL(picked.url) : undefined), [picked]);

  function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_BYTES) return setMessage({ text: "The picture is larger than 10 MB.", isError: true });
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
    setNatural(null);
    setPicked({ file, url: URL.createObjectURL(file) });
  }

  function close() {
    setPicked(null);
  }

  function save() {
    if (pending || !picked || !area || !natural) return;
    // Whole pixels, a square, inside the picture (the server checks the same and refuses otherwise).
    const size = Math.max(16, Math.min(Math.round(Math.min(area.width, area.height)), natural.width, natural.height));
    const x = Math.min(Math.max(0, Math.round(area.x)), natural.width - size);
    const y = Math.min(Math.max(0, Math.round(area.y)), natural.height - size);
    const form = new FormData();
    form.set("file", picked.file);
    form.set("x", String(x));
    form.set("y", String(y));
    form.set("size", String(size));
    startTransition(async () => {
      const result = await uploadAvatarAction(form);
      if (!result.ok) {
        setMessage({ text: result.fieldErrors?.file ?? result.fieldErrors?.crop ?? result.error, isError: true });
        return;
      }
      setPicked(null);
      setMessage({ text: "Your picture is saved.", isError: false });
      router.refresh();
    });
  }

  function remove() {
    if (pending) return;
    startTransition(async () => {
      const result = await removeAvatarAction();
      setMessage(result.ok ? { text: "Your picture is removed.", isError: false } : { text: result.error, isError: true });
      if (result.ok) router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold">Profile picture</h2>
        <p className="text-sm text-muted-foreground">Shown next to your name in the admin. Only a small square is kept.</p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        <UserAvatar name={user.name} email={user.email} image={user.image} className="size-16" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} aria-disabled={pending || undefined}>
            <FiUpload aria-hidden />
            {user.image ? "Change picture" : "Upload picture"}
          </Button>
          {user.image ? (
            <Button type="button" variant="ghost" onClick={remove} aria-disabled={pending || undefined}>
              <FiTrash2 aria-hidden />
              Remove
            </Button>
          ) : null}
          <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={choose} />
        </div>
        {message ? (
          <p role={message.isError ? "alert" : "status"} className={`w-full text-sm ${message.isError ? "text-destructive" : ""}`}>
            {message.text}
          </p>
        ) : null}
      </CardContent>

      <Dialog open={picked !== null} onOpenChange={(open) => (open ? undefined : close())}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Choose the part to show</DialogTitle>
            <DialogDescription>Drag the picture to move it, and zoom with the slider. With the keyboard, the arrow keys move it.</DialogDescription>
          </DialogHeader>
          {picked ? (
            <div className="relative h-72 w-full overflow-hidden rounded-md bg-black">
              <Cropper
                image={picked.url}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setArea(pixels)}
                onMediaLoaded={(media) => setNatural({ width: media.naturalWidth, height: media.naturalHeight })}
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="avatar-zoom">Zoom</Label>
            <input id="avatar-zoom" type="range" min={1} max={4} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-primary" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="button" onClick={save} aria-disabled={pending || !area || undefined}>
              {pending ? "Saving…" : "Save picture"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
