"use client";

import Image from "next/image";
import React from "react";
import { useWatch } from "react-hook-form";

import { petSeo } from "@/lib/pet-seo";
import type { Pet } from "@/server/types";

import type { FormControl } from "./fields";

// A live preview of how the pet's page may look in search results and when its link is shared. It
// reads the form as you type and uses the same fallbacks as the real page (src/lib/pet-seo.ts), so
// leaving a field blank shows the text that will be built for it. It is a guide: search engines and
// apps decide for themselves what to show.

const serverURL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3000";

/** "City, State" the way the server builds it, or the pet's saved location when both are blank. */
function locationOf(city: string, state: string, saved: string | null | undefined) {
  const parts = [city.trim(), state.trim()].filter(Boolean);
  if (parts.length === 2 && parts[0]!.toLowerCase() === parts[1]!.toLowerCase()) parts.pop();
  return parts.length > 0 ? parts.join(", ") : (saved ?? "");
}

export function SeoPreview({
  control,
  pet,
  siteName,
}: {
  control: FormControl;
  pet: Pet | null;
  siteName: string;
}) {
  const [name, status, species, breed, city, state, slug, seoTitle, seoDescription, seoImage, photos] =
    useWatch({
      control,
      name: [
        "name",
        "status",
        "species",
        "breed",
        "city",
        "state",
        "slug",
        "seoTitle",
        "seoDescription",
        "seoImage",
        "photos",
      ],
    });

  const seo = petSeo({
    name,
    status,
    speciesLabel: species,
    breed,
    ageDescription: pet?.ageDescription,
    location: locationOf(city, state, pet?.location),
    seoTitle,
    seoDescription,
  });
  const image = seoImage ?? photos[0] ?? null;
  const host = new URL(serverURL).host;
  const path = `/pets/${slug.trim() || "…"}`;
  const fullTitle = `${seo.title} | ${siteName}`;

  return (
    <section aria-labelledby="pet-seo-preview-heading" className="grid gap-4 border-t pt-6">
      <div>
        <h2 id="pet-seo-preview-heading" className="text-base font-semibold">
          Preview
        </h2>
        <p id="pet-seo-preview-hint" className="text-sm text-muted-foreground">
          How this page may look in search results and when its link is shared. It changes as you
          type. Search engines and apps decide for themselves what they show, so treat it as a guide.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2" aria-describedby="pet-seo-preview-hint">
        <figure className="m-0 grid content-start gap-2">
          <figcaption className="text-sm font-medium">Search result</figcaption>
          <div className="rounded-lg border bg-card p-4">
            <p className="truncate text-xs text-muted-foreground">
              {host}
              <span aria-hidden="true"> › pets › {slug.trim() || "…"}</span>
              <span className="sr-only">{path}</span>
            </p>
            <p className="mt-1 line-clamp-2 text-lg leading-snug text-primary">{fullTitle}</p>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {seo.description || "No description yet."}
            </p>
          </div>
          <Notes title={seo.titleIsAutomatic} description={seo.descriptionIsAutomatic} />
        </figure>

        <figure className="m-0 grid content-start gap-2">
          <figcaption className="text-sm font-medium">Shared link</figcaption>
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="relative aspect-[1.91/1] w-full bg-muted">
              {image ? (
                // Decorative: the image is described by the pet's photo text in the form.
                <Image
                  src={image.thumbnailUrl}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 24rem, 100vw"
                  className="object-cover"
                />
              ) : (
                <p className="grid h-full place-items-center p-4 text-center text-sm text-muted-foreground">
                  No image yet. Add a photo or choose a share image.
                </p>
              )}
            </div>
            <div className="grid gap-1 border-t p-3">
              <p className="truncate text-xs uppercase text-muted-foreground">{host}</p>
              <p className="line-clamp-2 text-sm font-semibold">{fullTitle}</p>
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {seo.description || "No description yet."}
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {seoImage ? "Using your share image." : "Using the cover photo. Choose a share image to change it."}
          </p>
        </figure>
      </div>
    </section>
  );
}

function Notes({ title, description }: { title: boolean; description: boolean }) {
  const automatic = [title ? "title" : null, description ? "description" : null].filter(Boolean);
  if (automatic.length === 0) return null;
  return (
    <p className="text-sm text-muted-foreground">
      The {automatic.join(" and ")} {automatic.length === 1 ? "is" : "are"} built from the pet&apos;s
      details. Fill in the field above to write your own.
    </p>
  );
}
