import z from "zod";

import { RESERVED_SLUGS } from "@/lib/options";
import { SLUG_PATTERN } from "@/lib/slugify";

// The page settings form's rules, checked in the browser before anything is sent. They mirror
// `parseDetails` in src/server/pages.ts, which stays the authority.

const mediaRef = z.object({
  id: z.number().int().positive(),
  thumbnailUrl: z.string(),
  alt: z.string(),
});

export const pageFormSchema = z.object({
  title: z.string().trim().min(1, "Enter a title.").max(120, "Use at most 120 characters."),
  slug: z
    .string()
    .trim()
    .min(1, "Enter an address.")
    .max(80, "Use at most 80 characters.")
    .regex(SLUG_PATTERN, "Use lowercase letters, numbers and single dashes only.")
    .refine((value) => !RESERVED_SLUGS.includes(value), {
      message: "This address is used by the site itself. Pick another one.",
    }),
  seoDescription: z.string().max(200, "Use at most 200 characters."),
  seoImage: mediaRef.nullable(),
});

export type PageFormValues = z.infer<typeof pageFormSchema>;
export type PageFormField = keyof PageFormValues;

/** In the order they appear, for the error summary. */
export const PAGE_FIELD_ORDER: PageFormField[] = ["title", "slug", "seoDescription", "seoImage"];

export const PAGE_FIELD_LABELS: Record<PageFormField, string> = {
  title: "Title",
  slug: "Address",
  seoDescription: "Search description",
  seoImage: "Share image",
};

/** The server's field names (`seoImageId`) on the form's fields. */
export function pageFormFieldFor(key: string): PageFormField | null {
  if (key === "seoImageId") return "seoImage";
  return (PAGE_FIELD_ORDER as string[]).includes(key) ? (key as PageFormField) : null;
}

/** The payload for `savePageDetailsAction`. Blank description becomes null. */
export function toPageInput(values: PageFormValues) {
  return {
    title: values.title.trim(),
    slug: values.slug.trim(),
    seoDescription: values.seoDescription.trim() || null,
    seoImageId: values.seoImage?.id ?? null,
  };
}
