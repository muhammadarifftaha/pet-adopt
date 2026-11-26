"use client";

import Image from "next/image";
import React, { useState } from "react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@pet-adopt/ui/components/carousel";

// The Pet gallery block (Pet page template): one large photo and a strip of thumbnails above or
// below it; choosing a thumbnail shows that photo large. The strip is shadcn's Carousel (Embla),
// styled by `.pet-gallery-*` rules in styles.css keyed to its `data-slot` attributes, because the
// page builder does not load Tailwind (see ImageCarousel).
//
// Accessibility: each thumbnail is a button named "Show photo N of M" with `aria-pressed` on the one
// shown, so keyboard and screen reader users choose photos the same way; the strip is a labelled
// region with Previous/Next buttons (and the arrow keys) when it scrolls.

export type GalleryPhoto = { url: string; alt: string };

export function PetGallery({
  photos,
  name,
  thumbnails = "below",
}: {
  photos: GalleryPhoto[];
  name: string;
  thumbnails?: "below" | "above";
}) {
  const [shown, setShown] = useState(0);
  if (photos.length === 0) return null;
  const current = photos[Math.min(shown, photos.length - 1)];
  const altOf = (photo: GalleryPhoto, index: number) => photo.alt || `${name} photo ${index + 1}`;

  const main = (
    <div className="pet-photo pet-gallery-main">
      <Image src={current.url} alt={altOf(current, shown)} fill priority sizes="(max-width: 960px) 100vw, 960px" />
    </div>
  );
  if (photos.length === 1) return <div className="pet-gallery-block">{main}</div>;

  const strip = (
    <Carousel className="pet-gallery-strip" opts={{ align: "start", containScroll: "trimSnaps" }} aria-label={`Photos of ${name}`}>
      <CarouselContent>
        {photos.map((photo, index) => (
          <CarouselItem key={`${photo.url}-${index}`}>
            <button
              type="button"
              className="pet-gallery-thumb"
              aria-pressed={index === shown}
              aria-label={`Show photo ${index + 1} of ${photos.length}`}
              onClick={() => setShown(index)}
            >
              <Image src={photo.url} alt="" fill sizes="160px" />
            </button>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  );

  return (
    <div className="pet-gallery-block">
      {thumbnails === "above" ? strip : null}
      {main}
      {thumbnails === "above" ? null : strip}
    </div>
  );
}
