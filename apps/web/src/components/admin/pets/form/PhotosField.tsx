"use client";

import React from "react";
import Image from "next/image";
import { Controller } from "react-hook-form";
import { FiArrowDown, FiArrowUp, FiPlus, FiTrash2 } from "react-icons/fi";

import { Button } from "@pet-adopt/ui/components/button";
import { FieldDescription, FieldError, FieldLegend, FieldSet } from "@pet-adopt/ui/components/field";
import { PET_MAX_PHOTOS, type PetFormMedia } from "@/lib/zod-schema/pet";

import { MediaPickerDialog } from "./MediaPickerDialog";
import { fieldId, type FormControl } from "./fields";

// The pet's photos, in order (the first is the cover). Reordering uses buttons, not dragging, so it
// works with a keyboard and a screen reader (WCAG 2.1.1, 2.5.7). Moving or removing a photo is
// announced, and focus stays on the control that was used.
export function PhotosField({ control }: { control: FormControl }) {
  const [open, setOpen] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState("");
  const id = fieldId("photos");
  const buttonId = (photoId: number, kind: "up" | "down" | "remove") => `${id}-${photoId}-${kind}`;

  /** Focus the first of these buttons that exists and is usable, once the list has re-rendered. */
  const focusSoon = (...ids: string[]) =>
    requestAnimationFrame(() => {
      for (const target of ids) {
        const element = document.getElementById(target) as HTMLButtonElement | null;
        if (element && !element.disabled && element.getAttribute("aria-disabled") !== "true") {
          element.focus();
          return;
        }
      }
    });

  return (
    <Controller
      name="photos"
      control={control}
      render={({ field, fieldState }) => {
        const photos = field.value;

        function move(index: number, delta: -1 | 1) {
          const next = [...photos];
          const [photo] = next.splice(index, 1);
          next.splice(index + delta, 0, photo);
          field.onChange(next);
          setAnnouncement(`${photo.alt || "Photo"} moved to position ${index + delta + 1} of ${photos.length}.`);
          const same = delta === -1 ? "up" : "down";
          focusSoon(buttonId(photo.id, same), buttonId(photo.id, same === "up" ? "down" : "up"));
        }

        function remove(index: number) {
          const photo = photos[index];
          const next = photos.filter((_, position) => position !== index);
          field.onChange(next);
          setAnnouncement(`${photo.alt || "Photo"} removed. ${next.length} of ${PET_MAX_PHOTOS} photos.`);
          const neighbour = next[index] ?? next[index - 1];
          focusSoon(...(neighbour ? [buttonId(neighbour.id, "remove")] : []), `${id}-add`);
        }

        function add(items: PetFormMedia[]) {
          const have = new Set(photos.map((photo) => photo.id));
          const fresh = items.filter((item) => !have.has(item.id));
          const next = [...photos, ...fresh].slice(0, PET_MAX_PHOTOS);
          field.onChange(next);
          setAnnouncement(`${fresh.length} photo${fresh.length === 1 ? "" : "s"} added. ${next.length} of ${PET_MAX_PHOTOS}.`);
        }

        return (
          <FieldSet
            id={id}
            data-invalid={fieldState.invalid || undefined}
            aria-describedby={`${id}-description${fieldState.error ? ` ${id}-error` : ""}`}
          >
            <FieldLegend variant="label">
              Photos<span className="font-normal text-muted-foreground"> (required)</span>
            </FieldLegend>
            <FieldDescription id={`${id}-description`}>
              Add 1 to {PET_MAX_PHOTOS} photos. The first one is the cover, shown on the pet&apos;s card.
              Use the buttons to change the order.
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
                      <p className="text-sm font-medium">{index === 0 ? "Cover photo" : `Photo ${index + 1}`}</p>
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
                ref={field.ref}
                disabled={photos.length >= PET_MAX_PHOTOS}
                onClick={() => setOpen(true)}
              >
                <FiPlus aria-hidden="true" />
                Add photos
              </Button>
              <span className="text-sm text-muted-foreground">
                {photos.length} of {PET_MAX_PHOTOS} added
              </span>
            </div>

            <FieldError id={`${id}-error`} errors={[fieldState.error]} />
            <p role="status" className="sr-only">
              {announcement}
            </p>

            <MediaPickerDialog
              open={open}
              onOpenChange={setOpen}
              title="Add photos"
              max={PET_MAX_PHOTOS - photos.length}
              onPick={add}
            />
          </FieldSet>
        );
      }}
    />
  );
}
