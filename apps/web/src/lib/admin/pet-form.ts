import { labelFor, PetStatus, SPECIES } from "@/lib/options";
import { isRichTextEmpty } from "@/lib/rich-text";
import type { PetFormMedia, PetFormValues } from "@/lib/zod-schema/pet";
import type { MediaItem, Pet } from "@/server/types";

// Glue between the pet form and `savePetAction`: the starting values, the payload, and which tab
// each field lives in (so an error can open the right tab).

export const TABS = [
  { id: "basics", label: "Basics" },
  { id: "health", label: "Health and behaviour" },
  { id: "photos", label: "Photos and story" },
  { id: "adoption", label: "Adoption" },
  { id: "seo", label: "Search and sharing" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

type FieldName = keyof PetFormValues;

// The tab of every field, in the order the form shows them (the error summary follows this order).
// `null` is the sidebar, which is always on screen.
export const FIELD_TAB: Record<FieldName, TabId | null> = {
  name: "basics",
  species: "basics",
  sex: "basics",
  size: "basics",
  breed: "basics",
  color: "basics",
  ageMode: "basics",
  birthDate: "basics",
  ageValue: "basics",
  ageUnit: "basics",
  ageDescription: "basics",
  ageGroup: "basics",
  city: "basics",
  state: "basics",
  location: "basics",
  vaccinated: "health",
  neutered: "health",
  microchipped: "health",
  houseTrained: "health",
  specialNeeds: "health",
  healthNotes: "health",
  temperament: "health",
  goodWith: "health",
  photos: "photos",
  description: "photos",
  videoUrl: "photos",
  adoptionFee: "adoption",
  rescuedAt: "adoption",
  contactWhatsApp: "adoption",
  seoTitle: "seo",
  seoDescription: "seo",
  seoImage: "seo",
  status: null,
  featured: null,
  unlisted: null,
  urgent: null,
  slug: null,
};

export const FIELD_ORDER = Object.keys(FIELD_TAB) as FieldName[];

/** What an error is called in the summary at the top of the form. */
export const FIELD_LABELS: Record<FieldName, string> = {
  name: "Name",
  species: "Species",
  sex: "Sex",
  size: "Size",
  breed: "Breed",
  color: "Colour",
  ageMode: "Age",
  birthDate: "Birth date",
  ageValue: "Age",
  ageUnit: "Age unit",
  ageDescription: "Age description",
  ageGroup: "Age group",
  city: "City",
  state: "State",
  location: "Location",
  vaccinated: "Vaccinated",
  neutered: "Neutered",
  microchipped: "Microchipped",
  houseTrained: "House trained",
  specialNeeds: "Special needs",
  healthNotes: "Health notes",
  temperament: "Temperament",
  goodWith: "Good with",
  photos: "Photos",
  description: "Description",
  videoUrl: "Video link",
  adoptionFee: "Adoption fee",
  rescuedAt: "Rescue date",
  contactWhatsApp: "WhatsApp number",
  seoTitle: "Search title",
  seoDescription: "Search description",
  seoImage: "Share image",
  status: "Status",
  featured: "Featured",
  unlisted: "Link only",
  urgent: "Urgent",
  slug: "Address",
};

/** The form field a name from the server's `fieldErrors` belongs to, or null if the form has none. */
export function formFieldFor(serverField: string): FieldName | null {
  if (serverField === "photoIds") return "photos";
  if (serverField === "seoImageId") return "seoImage";
  return serverField in FIELD_TAB ? (serverField as FieldName) : null;
}

const toRef = (media: MediaItem): PetFormMedia => ({
  id: media.id,
  url: media.url,
  thumbnailUrl: media.thumbnailUrl,
  alt: media.alt,
});

/** The values the form starts with: a new pet, or the pet being edited. */
export function petToFormValues(pet: Pet | null): PetFormValues {
  // A pet with a birth date keeps its age unless the owner picks another way; one without it
  // shows the typed description and picked group. (`ageDescription` and `ageGroup` on a pet with a
  // birth date are worked out live, so they are not put in the form.)
  const dated = Boolean(pet?.birthDate);

  return {
    name: pet?.name ?? "",
    species: pet ? labelFor(SPECIES, pet.species) : "",
    sex: (pet?.sex as PetFormValues["sex"] | null) ?? "",
    size: (pet?.size as PetFormValues["size"] | null) ?? "",
    breed: pet?.breed ?? "",
    color: pet?.color ?? "",
    city: pet?.city ?? "",
    state: pet?.state ?? "",
    location: pet?.location ?? "",

    ageMode: dated ? "keep" : pet ? "none" : "estimate",
    birthDate: pet?.birthDate ?? "",
    ageValue: "",
    ageUnit: "months",
    ageDescription: dated ? "" : (pet?.ageDescription ?? ""),
    ageGroup: dated ? "" : ((pet?.ageGroup as PetFormValues["ageGroup"] | null) ?? ""),

    vaccinated: pet?.vaccinated ?? false,
    neutered: pet?.neutered ?? false,
    microchipped: pet?.microchipped ?? false,
    houseTrained: pet?.houseTrained ?? false,
    specialNeeds: pet?.specialNeeds ?? false,
    healthNotes: pet?.healthNotes ?? null,
    temperament: (pet?.temperament ?? []) as PetFormValues["temperament"],
    goodWith: (pet?.goodWith ?? []) as PetFormValues["goodWith"],

    photos: pet?.photos.map(toRef) ?? [],
    description: pet?.description ?? null,
    videoUrl: pet?.videoUrl ?? "",

    adoptionFee: pet?.adoptionFee == null ? "" : String(pet.adoptionFee),
    rescuedAt: pet?.rescuedAt ?? "",
    contactWhatsApp: pet?.contactWhatsApp ?? "",

    seoTitle: pet?.seo.title ?? "",
    seoDescription: pet?.seo.description ?? "",
    seoImage: pet?.seo.image ? toRef(pet.seo.image) : null,

    status: pet?.status ?? PetStatus.Available,
    featured: pet?.featured ?? false,
    unlisted: pet?.unlisted ?? false,
    urgent: pet?.urgent ?? false,
    slug: pet?.slug ?? "",
  };
}

const blank = (value: string) => (value === "" ? null : value);

/**
 * The payload for `savePetAction`. A blank field is sent as null, which clears it. The age fields
 * depend on how the age was entered, and are left out when it was not changed: sending `ageValue`
 * again would work "about 8 months" out from today and move the pet's age.
 */
export function toPetInput(values: PetFormValues): Record<string, unknown> {
  const input: Record<string, unknown> = {
    name: values.name,
    status: values.status,
    species: values.species,
    sex: blank(values.sex),
    size: blank(values.size),
    breed: blank(values.breed),
    color: blank(values.color),
    city: blank(values.city),
    state: blank(values.state),
    location: blank(values.location),
    vaccinated: values.vaccinated,
    neutered: values.neutered,
    microchipped: values.microchipped,
    houseTrained: values.houseTrained,
    specialNeeds: values.specialNeeds,
    healthNotes: isRichTextEmpty(values.healthNotes) ? null : values.healthNotes,
    temperament: values.temperament,
    goodWith: values.goodWith,
    photoIds: values.photos.map((photo) => photo.id),
    description: isRichTextEmpty(values.description) ? null : values.description,
    videoUrl: blank(values.videoUrl),
    adoptionFee: values.adoptionFee === "" ? null : Number(values.adoptionFee),
    rescuedAt: blank(values.rescuedAt),
    contactWhatsApp: blank(values.contactWhatsApp),
    seoTitle: blank(values.seoTitle),
    seoDescription: blank(values.seoDescription),
    seoImageId: values.seoImage?.id ?? null,
    featured: values.featured,
    unlisted: values.unlisted,
    urgent: values.urgent,
  };

  // A blank address on an edit keeps the current one, and on a new pet it is made from the name.
  if (values.slug !== "") input.slug = values.slug;

  if (values.ageMode === "date" && values.birthDate !== "") {
    input.birthDate = values.birthDate;
  } else if (values.ageMode === "estimate" && values.ageValue !== "") {
    input.ageValue = Number(values.ageValue);
    input.ageUnit = values.ageUnit;
  } else if (values.ageMode === "none") {
    input.birthDate = null;
    input.ageDescription = blank(values.ageDescription);
    input.ageGroup = blank(values.ageGroup);
  }

  return input;
}
