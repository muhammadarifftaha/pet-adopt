"use client";

import React from "react";
import Image from "next/image";
import { Controller } from "react-hook-form";

import { Button } from "@pet-adopt/ui/components/button";
import { FieldDescription, FieldError, FieldLegend, FieldSet } from "@pet-adopt/ui/components/field";

import { MediaPickerDialog } from "./MediaPickerDialog";
import { fieldId, type FormControl } from "./fields";

// The picture shown when the pet's page is shared. One optional image from the media library.
export function SeoImageField({ control }: { control: FormControl }) {
  const [open, setOpen] = React.useState(false);
  const id = fieldId("seoImage");

  return (
    <Controller
      name="seoImage"
      control={control}
      render={({ field, fieldState }) => {
        const image = field.value;
        return (
          <FieldSet
            id={id}
            data-invalid={fieldState.invalid || undefined}
            aria-describedby={`${id}-description${fieldState.error ? ` ${id}-error` : ""}`}
          >
            <FieldLegend variant="label">Share image</FieldLegend>
            <FieldDescription id={`${id}-description`}>
              The picture shown when the pet&apos;s page is shared. Leave it empty to use the cover photo.
            </FieldDescription>

            {image ? (
              <div className="flex gap-3 rounded-lg border p-2">
                {/* Decorative: the description next to it says what the picture shows. */}
                <Image
                  src={image.thumbnailUrl}
                  alt=""
                  width={96}
                  height={72}
                  className="h-[72px] w-24 shrink-0 rounded object-cover"
                />
                <p className="line-clamp-3 text-sm">{image.alt}</p>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                id={`${id}-choose`}
                ref={field.ref}
                onClick={() => setOpen(true)}
              >
                {image ? "Change image" : "Choose image"}
              </Button>
              {image ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    field.onChange(null);
                    requestAnimationFrame(() => document.getElementById(`${id}-choose`)?.focus());
                  }}
                >
                  Remove image
                </Button>
              ) : null}
            </div>

            <FieldError id={`${id}-error`} errors={[fieldState.error]} />

            <MediaPickerDialog
              open={open}
              onOpenChange={setOpen}
              title="Choose the share image"
              max={1}
              onPick={(items) => field.onChange(items[0] ?? null)}
            />
          </FieldSet>
        );
      }}
    />
  );
}
