"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { AgeFields } from "@/components/admin/pets/form/AgeFields";
import { useUnsavedChanges } from "@/components/admin/useUnsavedChanges";
import { ErrorSummary, type SummaryItem } from "@/components/admin/pets/form/ErrorSummary";
import {
  CheckboxField,
  CheckboxGroupField,
  SelectField,
  SpeciesField,
  TextField,
  TextareaField,
  focusField,
} from "@/components/admin/pets/form/fields";
import { LocationFields } from "@/components/admin/pets/form/LocationFields";
import { PhotosField } from "@/components/admin/pets/form/PhotosField";
import { RichTextField } from "@/components/admin/pets/form/RichTextField";
import { useViewOnly, ViewOnlyFieldset } from "@/components/admin/view-only";
import { SeoPreview } from "@/components/admin/pets/form/SeoPreview";
import { DESCRIPTION_MAX_CHARS } from "@/lib/rich-text";
import { SeoImageField } from "@/components/admin/pets/form/SeoImageField";
import { Button, buttonVariants } from "@pet-adopt/ui/components/button";
import { Card, CardContent, CardHeader } from "@pet-adopt/ui/components/card";
import { FieldGroup, FieldLegend, FieldSet } from "@pet-adopt/ui/components/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pet-adopt/ui/components/tabs";
import {
  FIELD_LABELS,
  FIELD_ORDER,
  FIELD_TAB,
  TABS,
  formFieldFor,
  petToFormValues,
  toPetInput,
  type TabId,
} from "@/lib/admin/pet-form";
import { callAction } from "@/lib/admin/call-action";
import { SPECIES_CACHE_KEY, useInvalidatePets } from "@/lib/admin/pets-cache";
import { unwrapResult } from "@/lib/admin/unwrap-client";
import { GOOD_WITH, SEXES, SIZES, SPECIES, STATUSES, TEMPERAMENTS } from "@/lib/options";
import { cn } from "@/lib/utils";
import { petFormSchema, type PetFormValues } from "@/lib/zod-schema/pet";
import { listSpeciesOptionsAction, savePetAction } from "@/server/actions/pets";
import type { Pet } from "@/server/types";

// The pet form, for a new pet (pet = null) and for editing one. React Hook Form holds the values,
// zod checks them (src/lib/zod-schema/pet.ts), shadcn components draw them. Built to WCAG 2.2 AA:
//  - every control has a visible label, a hint and its error tied to it (see form/fields.tsx);
//  - after a failed save an error summary takes focus, lists every problem, and each link opens the
//    right tab and focuses the field; tabs say how many errors they hold (3.3.1, 3.3.3, 2.4.3);
//  - photos are reordered with buttons, never only by dragging (2.1.1, 2.5.7);
//  - "Saving…" and "Saved." go through a polite live region (4.1.3), and the save button stays
//    focusable while saving, so focus is never lost;
//  - there is no sticky footer, which could cover a focused field (2.4.11).
export function PetForm({ pet, siteName, siteCountry }: { pet: Pet | null; siteName: string; siteCountry: string }) {
  // View-only roles (audit) see every field, can switch tabs, and cannot save (the server refuses too).
  const viewOnly = useViewOnly();
  const router = useRouter();
  const invalidatePets = useInvalidatePets();

  // `values` makes the form start again with the fresh pet after `router.refresh()` (a save).
  const initial = React.useMemo(() => petToFormValues(pet, siteCountry), [pet, siteCountry]);
  const form = useForm<PetFormValues>({
    resolver: zodResolver(petFormSchema),
    values: initial,
    // When the page reloads, fields the person has changed keep their text.
    resetOptions: { keepDirtyValues: true },
    mode: "onBlur",
    // The error summary takes focus instead (it links to each field, switching tabs).
    shouldFocusError: false,
  });
  const { control, formState } = form;
  const { dialog: leaveDialog, allowNavigation } = useUnsavedChanges(formState.isDirty);

  const [tab, setTab] = React.useState<TabId>("basics");
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [general, setGeneral] = React.useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = React.useState(false);
  const [focusTick, setFocusTick] = React.useState(0);
  const summaryRef = React.useRef<HTMLDivElement>(null);

  // Species suggestions for the field: the usual ones plus any the owners added.
  const { data: speciesInUse } = useSWR(SPECIES_CACHE_KEY, async () =>
    unwrapResult(await listSpeciesOptionsAction()),
  );
  const suggestions = Array.from(
    new Set([...SPECIES.map((option) => option.label), ...(speciesInUse ?? []).map((option) => option.label)]),
  );

  // Each problem, in the order of the form, for the summary and the count on each tab.
  const items: SummaryItem[] = FIELD_ORDER.flatMap((name) => {
    const entry = formState.errors[name] as { message?: string; root?: { message?: string } } | undefined;
    const message = entry?.message ?? entry?.root?.message;
    return message ? [{ name, label: FIELD_LABELS[name], message }] : [];
  });
  const errorsByTab = new Map<TabId, number>();
  for (const item of items) {
    const owner = FIELD_TAB[item.name as keyof PetFormValues];
    if (owner) errorsByTab.set(owner, (errorsByTab.get(owner) ?? 0) + 1);
  }
  const showSummary = summaryOpen && (items.length > 0 || general !== null);
  // "Saved." only while nothing has been changed since.
  const showSaved = saved && !formState.isDirty;

  // Moves focus to the summary after a failed save, once it is on screen: React Hook Form can
  // publish the errors one render after the failed submit, so wait for the summary itself.
  const focusPending = React.useRef(false);
  React.useEffect(() => {
    if (focusTick > 0) focusPending.current = true;
  }, [focusTick]);
  React.useEffect(() => {
    if (focusPending.current && showSummary && summaryRef.current) {
      focusPending.current = false;
      summaryRef.current.focus();
    }
  });

  function problems() {
    setSummaryOpen(true);
    setFocusTick((tick) => tick + 1);
  }

  async function onValid(values: PetFormValues) {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setGeneral(null);

    // callAction: a call that never arrives (network, redeploy) becomes a message, not a stuck "Saving…".
    const result = await callAction(savePetAction(pet?.id ?? null, toPetInput(values)));
    setSaving(false);

    if (result.ok) {
      setSummaryOpen(false);
      void invalidatePets();
      // What was just saved is the new clean state; the reload then brings the server's version
      // (a generated slug, a normalised species) into the fields nobody is editing.
      form.reset(values);
      if (pet) {
        setSaved(true);
        router.refresh();
      } else {
        allowNavigation();
        router.push(`/admin/pets/${result.data.id}`);
      }
      return;
    }

    // The server checks the same rules again. Show what it found on the fields, and anything it
    // names that the form has no field for in the summary.
    const unplaced: string[] = [];
    for (const [key, message] of Object.entries(result.fieldErrors ?? {})) {
      const name = formFieldFor(key);
      if (name) form.setError(name, { type: "server", message });
      else unplaced.push(`${key}: ${message}`);
    }
    setGeneral(result.fieldErrors ? (unplaced.length > 0 ? unplaced.join(" ") : null) : result.error);
    problems();
  }

  // A link in the summary: open the tab that holds the field, then focus it once the panel is there.
  function goTo(name: string) {
    const owner = FIELD_TAB[name as keyof PetFormValues];
    if (owner) setTab(owner);
    requestAnimationFrame(() => requestAnimationFrame(() => focusField(name)));
  }

  return (
    <form
      noValidate
      aria-label={pet ? `Edit ${pet.name}` : "New pet"}
      onSubmit={form.handleSubmit(onValid, problems)}
    >
      {showSummary ? <ErrorSummary ref={summaryRef} items={items} general={general} onSelect={goTo} /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          <Tabs value={tab} onValueChange={(value) => setTab(value as TabId)}>
            {/* The list's own height is set by a variant (group-data-horizontal/tabs:h-8), which a plain
                h-auto loses to; the same variant here lets it grow with the taller tab buttons. */}
            <TabsList className="h-auto w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto">
              {TABS.map(({ id, label }) => {
                const count = errorsByTab.get(id) ?? 0;
                return (
                  <TabsTrigger key={id} value={id} className="h-auto flex-none px-3 py-1.5">
                    {label}
                    {count > 0 ? (
                      <>
                        <span aria-hidden="true" className="size-2 rounded-full bg-destructive" />
                        <span className="sr-only">
                          , {count} {count === 1 ? "error" : "errors"}
                        </span>
                      </>
                    ) : null}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            <TabsContent value="basics" className="pt-4">
              <ViewOnlyFieldset>
              <FieldGroup>
                <TextField control={control} name="name" label="Name" required />
                <SpeciesField
                  control={control}
                  name="species"
                  label="Species"
                  required
                  description="Pick one from the list or type your own, for example guinea pig."
                  options={suggestions}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField control={control} name="sex" label="Sex" options={SEXES} />
                  <SelectField control={control} name="size" label="Size" options={SIZES} />
                </div>
                <TextField control={control} name="breed" label="Breed" />
                <TextField control={control} name="color" label="Colour" />
                <AgeFields
                  control={control}
                  hasBirthDate={Boolean(pet?.birthDate)}
                  currentAge={pet?.birthDate ? pet.ageDescription : null}
                />
                <LocationFields control={control} />
                <TextField
                  control={control}
                  name="location"
                  label="Location"
                  description="Used only when the city and state are empty. Otherwise it is made from them."
                />
              </FieldGroup>
              </ViewOnlyFieldset>
            </TabsContent>

            <TabsContent value="health" className="pt-4">
              <ViewOnlyFieldset>
              <FieldGroup>
                <FieldSet>
                  <FieldLegend variant="label">Health and care</FieldLegend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <CheckboxField control={control} name="vaccinated" label="Vaccinated" />
                    <CheckboxField control={control} name="neutered" label="Neutered or spayed" />
                    <CheckboxField control={control} name="microchipped" label="Microchipped" />
                    <CheckboxField control={control} name="houseTrained" label="House trained" />
                    <CheckboxField control={control} name="specialNeeds" label="Has special needs" />
                  </div>
                </FieldSet>
                <RichTextField
                  control={control}
                  name="healthNotes"
                  label="Health notes"
                  description="Bold, italic, underline, lists and links. Up to 2000 characters."
                />
                <CheckboxGroupField control={control} name="temperament" label="Temperament" options={TEMPERAMENTS} />
                <CheckboxGroupField control={control} name="goodWith" label="Good with" options={GOOD_WITH} />
                <RichTextField
                  control={control}
                  name="personalityNotes"
                  label="Personality notes"
                  description="Anything about their character the lists above cannot say. Bold, italic, underline, lists and links. Up to 2000 characters."
                />
              </FieldGroup>
              </ViewOnlyFieldset>
            </TabsContent>

            <TabsContent value="photos" className="pt-4">
              <ViewOnlyFieldset>
              <FieldGroup>
                <PhotosField control={control} />
                <RichTextField
                  control={control}
                  name="description"
                  label="Description"
                  description="Bold, italic, underline, lists and links. Up to 5000 characters."
                  maxChars={DESCRIPTION_MAX_CHARS}
                />
                <TextField
                  control={control}
                  name="videoUrl"
                  label="Video link"
                  description="A link starting with https://, for example a YouTube link."
                  type="url"
                  inputMode="url"
                />
              </FieldGroup>
              </ViewOnlyFieldset>
            </TabsContent>

            <TabsContent value="adoption" className="pt-4">
              <ViewOnlyFieldset>
              <FieldGroup>
                <TextField
                  control={control}
                  name="adoptionFee"
                  label="Adoption fee"
                  description="A number only, for example 150. Leave it empty if there is no fee."
                  inputMode="decimal"
                />
                <TextField control={control} name="rescuedAt" label="Rescue date" type="date" />
                <TextField
                  control={control}
                  name="contactWhatsApp"
                  label="WhatsApp number for this pet"
                  description="Optional. Leave it empty to use the number in the site settings."
                  type="tel"
                  inputMode="tel"
                />
              </FieldGroup>
              </ViewOnlyFieldset>
            </TabsContent>

            <TabsContent value="seo" className="pt-4">
              <ViewOnlyFieldset>
              <FieldGroup>
                <TextField
                  control={control}
                  name="seoTitle"
                  label="Search title"
                  description="Shown in search results and when shared. Up to 70 characters."
                />
                <TextareaField
                  control={control}
                  name="seoDescription"
                  label="Search description"
                  description="Up to 160 characters."
                  rows={3}
                />
                <SeoImageField control={control} />
              </FieldGroup>
              <div className="mt-6">
                <SeoPreview control={control} pet={pet} siteName={siteName} />
              </div>
              </ViewOnlyFieldset>
            </TabsContent>
          </Tabs>
        </div>

        <aside aria-labelledby="pet-sidebar-heading">
          <ViewOnlyFieldset>
          <Card>
            <CardHeader>
              <h2 id="pet-sidebar-heading" className="text-base font-semibold">
                Status and visibility
              </h2>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <SelectField
                  control={control}
                  name="status"
                  label="Status"
                  required
                  options={STATUSES}
                  allowEmpty={false}
                />
                <CheckboxField
                  control={control}
                  name="featured"
                  label="Featured"
                  description="Can be shown first in featured pet grids."
                />
                <CheckboxField
                  control={control}
                  name="unlisted"
                  label="Link only"
                  description="Hidden from the catalog and from search. Anyone with the link can still open the page."
                />
                <CheckboxField
                  control={control}
                  name="urgent"
                  label="Urgent"
                  description="Marks a pet that needs a home soon."
                />
                <TextField
                  control={control}
                  name="slug"
                  label="Address"
                  description="Leave it empty to make it from the name. Lowercase letters, numbers and dashes."
                />
                {pet?.adoptedAt ? (
                  <p className="text-sm">
                    <span className="font-medium">Adopted on</span> {pet.adoptedAt.toISOString().slice(0, 10)}
                  </p>
                ) : null}
              </FieldGroup>
            </CardContent>
          </Card>
          </ViewOnlyFieldset>
        </aside>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-4">
        {/* aria-disabled, not disabled: a disabled button would drop keyboard focus mid-save. */}
        {viewOnly ? null : (
          <Button type="submit" aria-disabled={saving} className={cn(saving && "opacity-50")}>
            {pet ? "Save changes" : "Add pet"}
          </Button>
        )}
        <Link href="/admin/pets" className={buttonVariants({ variant: "outline" })}>
          {pet ? "Back to pets" : "Cancel"}
        </Link>
        <p role="status" aria-live="polite" className="text-sm">
          {saving ? "Saving…" : showSaved ? "Saved." : ""}
        </p>
      </div>
      {leaveDialog}
    </form>
  );
}
