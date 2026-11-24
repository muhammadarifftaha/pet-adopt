import z from "zod";

import { validateLink, validateWebUrl } from "@/lib/links";
import { SOCIAL_PLATFORMS } from "@/lib/options";
import { validatePhone } from "@/lib/phone";
import type { SiteSetting } from "@/server/types";

// The site settings form's rules, checked in the browser before anything is sent. They reuse the
// server's own validators (src/server/settings.ts stays the authority). The theme is not here: it
// has its own screen (/admin/theme).

const MAX_LIST_ITEMS = 20;
const mediaRef = z.object({ id: z.number().int().positive(), thumbnailUrl: z.string(), alt: z.string() });
const check = (result: true | string) => result === true;
const platformValues = SOCIAL_PLATFORMS.map((option) => option.value) as [string, ...string[]];

export const settingsFormSchema = z.object({
  siteName: z.string().trim().min(1, "Enter the site's name.").max(80, "Use at most 80 characters."),
  tagline: z.string().max(160, "Use at most 160 characters."),
  logo: mediaRef.nullable(),
  /** Checked for size and shape on the server (the picker does not send the image's dimensions). */
  favicon: mediaRef.nullable(),
  allowModeToggle: z.boolean(),
  whatsappNumber: z
    .string()
    .max(40, "Use at most 40 characters.")
    // The same libphonenumber check as the server. The phone input sends E.164 ("+60123456789").
    .superRefine((value, ctx) => {
      const result = value.trim() ? validatePhone(value) : true;
      if (result !== true) ctx.addIssue({ code: "custom", message: result });
    }),
  whatsappMessage: z.string().max(300, "Use at most 300 characters."),
  address: z.string().max(500, "Use at most 500 characters."),
  openingHours: z.string().max(500, "Use at most 500 characters."),
  socials: z
    .array(
      z.object({
        platform: z.enum(platformValues, "Choose a platform."),
        url: z
          .string()
          .trim()
          .min(1, "Enter the link.")
          .max(300, "Use at most 300 characters.")
          .refine((value) => check(validateWebUrl(value)), "Enter a full link starting with https://"),
      }),
    )
    .max(MAX_LIST_ITEMS, `Use at most ${MAX_LIST_ITEMS} links.`),
  nav: z
    .array(
      z.object({
        label: z.string().trim().min(1, "Enter the link text.").max(40, "Use at most 40 characters."),
        href: z
          .string()
          .trim()
          .min(1, "Enter where the link goes.")
          .max(300, "Use at most 300 characters.")
          .refine((value) => check(validateLink(value)), "Use a path like /pets, or a full link starting with https://"),
      }),
    )
    .max(MAX_LIST_ITEMS, `Use at most ${MAX_LIST_ITEMS} menu links.`),
  footerText: z.string().max(500, "Use at most 500 characters."),
});

export type SettingsFormValues = z.infer<typeof settingsFormSchema>;

export function settingsToFormValues(settings: SiteSetting): SettingsFormValues {
  return {
    siteName: settings.siteName ?? "",
    tagline: settings.tagline ?? "",
    logo: settings.logo ? { id: settings.logo.id, thumbnailUrl: settings.logo.thumbnailUrl, alt: settings.logo.alt } : null,
    favicon: settings.favicon ? { id: settings.favicon.id, thumbnailUrl: settings.favicon.thumbnailUrl, alt: settings.favicon.alt } : null,
    allowModeToggle: settings.allowModeToggle,
    whatsappNumber: settings.whatsappNumber ?? "",
    whatsappMessage: settings.whatsappMessage ?? "",
    address: settings.address ?? "",
    openingHours: settings.openingHours ?? "",
    socials: (settings.socials ?? []).map((item) => ({ platform: item.platform, url: item.url })),
    nav: (settings.nav ?? []).map((item) => ({ label: item.label, href: item.href })),
    footerText: settings.footerText ?? "",
  };
}

const orNull = (value: string) => (value.trim() ? value.trim() : null);

/** The payload for `updateSettingsAction`. Blank text becomes null; lists are sent whole. */
export function toSettingsInput(values: SettingsFormValues) {
  return {
    siteName: values.siteName.trim(),
    tagline: orNull(values.tagline),
    logoId: values.logo?.id ?? null,
    faviconId: values.favicon?.id ?? null,
    allowModeToggle: values.allowModeToggle,
    whatsappNumber: orNull(values.whatsappNumber),
    whatsappMessage: orNull(values.whatsappMessage),
    address: orNull(values.address),
    openingHours: orNull(values.openingHours),
    socials: values.socials.map((item) => ({ platform: item.platform, url: item.url.trim() })),
    nav: values.nav.map((item) => ({ label: item.label.trim(), href: item.href.trim() })),
    footerText: orNull(values.footerText),
  };
}

export type SettingsTab = "brand" | "contact" | "navigation";

/** Which tab a field (or a list row's field, `socials.2.url`) is on, and its name in error messages. */
export function settingsFieldInfo(name: string): { tab: SettingsTab; label: string } {
  const [head, index, sub] = name.split(".");
  const row = index !== undefined ? ` ${Number(index) + 1}` : "";
  switch (head) {
    case "siteName":
      return { tab: "brand", label: "Site name" };
    case "tagline":
      return { tab: "brand", label: "Tagline" };
    case "logo":
    case "logoId":
      return { tab: "brand", label: "Logo" };
    case "favicon":
    case "faviconId":
      return { tab: "brand", label: "Site icon" };
    case "allowModeToggle":
      return { tab: "brand", label: "Light and dark switch" };
    case "whatsappNumber":
      return { tab: "contact", label: "WhatsApp number" };
    case "whatsappMessage":
      return { tab: "contact", label: "WhatsApp message" };
    case "address":
      return { tab: "contact", label: "Address" };
    case "openingHours":
      return { tab: "contact", label: "Opening hours" };
    case "socials":
      return { tab: "contact", label: `Social link${row}${sub === "platform" ? ", platform" : sub === "url" ? ", link" : ""}` };
    case "nav":
      return { tab: "navigation", label: `Menu link${row}${sub === "label" ? ", text" : sub === "href" ? ", address" : ""}` };
    case "footerText":
      return { tab: "navigation", label: "Footer text" };
    default:
      return { tab: "brand", label: name };
  }
}

/** Server error keys on the form's field names (`logoId` is the `logo` field, `faviconId` the `favicon`). */
export const settingsFormField = (key: string) => (key === "logoId" ? "logo" : key === "faviconId" ? "favicon" : key);
