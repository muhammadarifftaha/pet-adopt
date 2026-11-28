"use client";

import React from "react";
import Image from "next/image";
import { FiArrowDown, FiArrowUp, FiPlus, FiTrash2 } from "react-icons/fi";

import { Button } from "@pet-adopt/ui/components/button";
import { FieldDescription, FieldError, FieldLegend, FieldSet } from "@pet-adopt/ui/components/field";
import { TIMELINE_MAX_PHOTOS } from "@/lib/pet-timeline";
import type { TimelineFormPhoto } from "@/lib/zod-schema/pet-timeline";

import { MediaPickerDialog } from "../form/MediaPickerDialog";

// An update's photos, in order, from the media library. Same pattern as the pet form's PhotosField:
// reordering uses buttons, never only dragging (WCAG 2.1.1, 2.5.7), each change is announced, and
// focus stays on the control that was used (or its neighbour).
export function TimelinePhotosField({
  id,
  value,
  onChange,
  error,
  buttonRef,
}: {
  id: string;
  value: TimelineFormPhoto[];
  onChange: (value: TimelineFormPhoto[]) => void;
  error?: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  const [open, setOpen] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState("");
  const photos = value;
  const buttonId = (photoId: number, kind: "up" | "down" | "remove") => `${id}-${photoId}-${kind}`;

  const focusSoon = (...ids: string[]) =>
    requestAnimationFrame(() => {
      for (const target of ids) {
        const element = document.getElementById(target) as HTMLButtonElement | null;
        if (element && !element.disabled) {
          element.focus();
          return;
        }
      }
    });

  function move(index: number, delta: -1 | 1) {
    const next = [...photos];
    const [photo] = next.splice(index, 1);
    next.splice(index + delta, 0, photo);
    onChange(next);
    setAnnouncement(`${photo.alt || "Photo"} moved to position ${index + delta + 1} of ${photos.length}.`);
    const same = delta === -1 ? "up" : "down";
    focusSoon(buttonId(photo.id, same), buttonId(photo.id, same === "up" ? "down" : "up"));
  }

  function remove(index: number) {
    const photo = photos[index];
    const next = photos.filter((_, position) => position !== index);
    onChange(next);
    setAnnouncement(`${photo.alt || "Photo"} removed. ${next.length} of ${TIMELINE_MAX_PHOTOS} photos.`);
    const neighbour = next[index] ?? next[index - 1];
    focusSoon(...(neighbour ? [buttonId(neighbour.id, "remove")] : []), `${id}-add`);
  }

  function add(items: TimelineFormPhoto[]) {
    const have = new Set(photos.map((photo) => photo.id));
    const fresh = items.filter((item) => !have.has(item.id));
    const next = [...photos, ...fresh].slice(0, TIMELINE_MAX_PHOTOS);
    onChange(next);
    setAnnouncement(`${fresh.length} photo${fresh.length === 1 ? "" : "s"} added. ${next.length} of ${TIMELINE_MAX_PHOTOS}.`);
  }

  return (
    <FieldSet
      id={id}
      data-invalid={error ? true : undefined}
      aria-describedby={`${id}-description${error ? ` ${id}-error` : ""}`}
    >
      <FieldLegend variant="label">Photos</FieldLegend>
      <FieldDescription id={`${id}-description`}>
        Optional. Up to {TIMELINE_MAX_PHOTOS} photos from the media library. Use the buttons to change the order.
      </FieldDescription>

      {photos.length > 0 ? (
        <ol className="grid gap-3 sm:grid-cols-2">
          {photos.map((photo, index) => (
            <li key={photo.id} className="flex gap-3 rounded-lg border p-2">
              {/* Decorative: the description next to it says what the picture shows. */}
              <Image
                src={photo.thumbnailUrl}
                alt=""
                width={96}
                height={72}
                className="h-[72px] w-24 shrink-0 rounded object-cover"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <p className="text-sm font-medium">Photo {index + 1}</p>
                <p className="line-clamp-2 text-xs text-muted-foreground">{photo.alt}</p>
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    id={buttonId(photo.id, "up")}
                    aria-label={`Move photo ${index + 1} up: ${photo.alt}`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <FiArrowUp aria-hidden="true" />
                    Up
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    id={buttonId(photo.id, "down")}
                    aria-label={`Move photo ${index + 1} down: ${photo.alt}`}
                    disabled={index === photos.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <FiArrowDown aria-hidden="true" />
                    Down
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    id={buttonId(photo.id, "remove")}
                    aria-label={`Remove photo ${index + 1}: ${photo.alt}`}
                    onClick={() => remove(index)}
                  >
                    <FiTrash2 aria-hidden="true" />
                    Remove
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          id={`${id}-add`}
          ref={buttonRef}
          disabled={photos.length >= TIMELINE_MAX_PHOTOS}
          onClick={() => setOpen(true)}
        >
          <FiPlus aria-hidden="true" />
          Add photos
        </Button>
        <span className="text-sm text-muted-foreground">
          {photos.length} of {TIMELINE_MAX_PHOTOS} added
        </span>
      </div>

      <FieldError id={`${id}-error`} errors={[error ? { message: error } : undefined]} />
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <MediaPickerDialog
        open={open}
        onOpenChange={setOpen}
        title="Add photos to this update"
        max={TIMELINE_MAX_PHOTOS - photos.length}
        onPick={add}
      />
    </FieldSet>
  );
}
