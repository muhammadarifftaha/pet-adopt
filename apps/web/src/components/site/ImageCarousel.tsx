"use client";

import Image from "next/image";
import React from "react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@pet-adopt/ui/components/carousel";

// The Image carousel block (shadcn's Carousel, on Embla). It is laid out by `.carousel-block` rules in
// the site's styles.css, keyed to the `data-slot` attributes the shadcn parts render, so it looks the
// same on the public site (where Tailwind is loaded) and in the page builder (where it is not).
// Accessibility comes from the shadcn parts: a labelled region, slides announced as "slide", buttons
// with "Previous slide"/"Next slide", and the arrow keys.

export type CarouselImage = { url: string; alt: string; caption: string };

export function ImageCarousel({ items, label }: { items: CarouselImage[]; label: string }) {
  if (items.length === 0) return null;
  const several = items.length > 1;
  return (
    <Carousel className="carousel-block" opts={{ loop: several }} aria-label={label || "Image carousel"}>
      <CarouselContent>
        {items.map((item, index) => (
          <CarouselItem key={index} aria-label={`${index + 1} of ${items.length}`}>
            <figure className="carousel-figure">
              <div className="carousel-image">
                <Image
                  src={item.url}
                  alt={item.alt || item.caption || ""}
                  fill
                  sizes="(max-width: 960px) 100vw, 960px"
                />
              </div>
              {item.caption ? <figcaption>{item.caption}</figcaption> : null}
            </figure>
          </CarouselItem>
        ))}
      </CarouselContent>
      {several ? (
        <>
          <CarouselPrevious />
          <CarouselNext />
        </>
      ) : null}
    </Carousel>
  );
}
