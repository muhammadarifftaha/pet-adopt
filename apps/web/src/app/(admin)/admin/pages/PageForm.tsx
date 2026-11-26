"use client";

import { useViewOnly } from "@/components/admin/view-only";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FiExternalLink } from "react-icons/fi";

import { StatusBadge } from "@/components/admin/StatusBadge";
import { useUnsavedChanges } from "@/components/admin/useUnsavedChanges";
import { ErrorSummary, type SummaryItem } from "@/components/admin/pets/form/ErrorSummary";
import { MediaPickerDialog } from "@/components/admin/pets/form/MediaPickerDialog";
import { Button, buttonVariants } from "@pet-adopt/ui/components/button";
import { Card, CardContent, CardHeader } from "@pet-adopt/ui/components/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@pet-adopt/ui/components/field";
import { Input } from "@pet-adopt/ui/components/input";
import { Textarea } from "@pet-adopt/ui/components/textarea";
import { slugify } from "@/lib/slugify";
import { isSystemPageSlug } from "@/puck/data";
import { cn } from "@/lib/utils";
import {
  PAGE_FIELD_LABELS,
  PAGE_FIELD_ORDER,
  pageFormFieldFor,
  pageFormSchema,
  toPageInput,
  type PageFormField,
  type PageFormValues,
} from "@/lib/zod-schema/page";
import {
  archivePageAction,
  publishPageAction,
  restorePageAction,
  savePageDetailsAction,
  unpublishPageAction,
} from "@/server/actions/pages";
import type { PageStatus } from "@/server/types";

// The page settings form: title, address and the search/sharing details. The layout itself is made
// in the page builder (/edit/<id>), opened from the form's own button row. The sidebar publishes,
// unpublishes or archives the page. Same accessibility rules as the pet form: visible labels and
// "(required)", hints and errors tied with aria-describedby, an error summary that takes focus,
// aria-disabled (not disabled) on buttons that are busy.

/** What the form needs to know about a saved page. The layout JSON stays on the server. */
export type PageFormPage = {
  id: number;
  title: string;
  slug: string;
  status: PageStatus;
  archived: boolean;
  publishedAt: Date | null;
  seoDescription: string | null;
  seoImage: { id: number; thumbnailUrl: string; alt: string } | null;
  hasLayout: boolean;
  hasUnpublishedChanges: boolean;
};

const fieldId = (name: string) => `page-${name}`;
const pagePath = (slug: string) => (slug === "home" ? "/" : `/${slug}`);

function Required() {
  return <span className="font-normal text-muted-foreground"> (required)</span>;
}

function describedBy(name: string, hasDescription: boolean, hasError: boolean) {
  const ids = [hasDescription ? `${fieldId(name)}-description` : null, hasError ? `${fieldId(name)}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

function TextInputField({
  control,
  name,
  label,
  description,
  required,
  prefix,
  onEdited,
  readOnly,
}: {
  control: Control<PageFormValues>;
  name: "title" | "slug";
  label: string;
  description?: string;
  required?: boolean;
  /** Fixed text shown before the box, e.g. the site address. */
  prefix?: string;
  /** Called when the person types in this box. */
  onEdited?: () => void;
  /** Shown and submitted, but not editable. */
  readOnly?: boolean;
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const id = fieldId(name);
        const input = (
          <Input
            id={id}
            ref={field.ref}
            name={field.name}
            autoComplete="off"
            readOnly={readOnly}
            value={field.value}
            onChange={(event) => {
              field.onChange(event);
              onEdited?.();
            }}
            onBlur={field.onBlur}
            aria-invalid={fieldState.invalid}
            aria-required={required || undefined}
            aria-describedby={describedBy(name, Boolean(description), Boolean(fieldState.error))}
          />
        );
        return (
          <Field data-invalid={fieldState.invalid || undefined}>
            <FieldLabel htmlFor={id}>
              {label}
              {required ? <Required /> : null}
            </FieldLabel>
            {description ? <FieldDescription id={`${id}-description`}>{description}</FieldDescription> : null}
            {prefix ? (
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground" aria-hidden="true">
                  {prefix}
                </span>
                {input}
              </div>
            ) : (
              input
            )}
            <FieldError id={`${id}-error`} errors={[fieldState.error]} />
          </Field>
        );
      }}
    />
  );
}

function ShareImageField({ control }: { control: Control<PageFormValues> }) {
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
              The picture shown when a link to this page is shared. Optional.
            </FieldDescription>
            {image ? (
              <div className="flex gap-3 rounded-lg border p-2">
                {/* Decorative: the description next to it says what the picture shows. */}
                <Image src={image.thumbnailUrl} alt="" width={96} height={72} className="h-18 w-24 shrink-0 rounded object-cover" />
                <p className="line-clamp-3 text-sm">{image.alt}</p>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" id={`${id}-choose`} ref={field.ref} onClick={() => setOpen(true)}>
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

function DescriptionField({ control }: { control: Control<PageFormValues> }) {
  const value = useWatch({ control, name: "seoDescription" });
  return (
    <Controller
      name="seoDescription"
      control={control}
      render={({ field, fieldState }) => {
        const id = fieldId("seoDescription");
        return (
          <Field data-invalid={fieldState.invalid || undefined}>
            <FieldLabel htmlFor={id}>Search description</FieldLabel>
            <FieldDescription id={`${id}-description`}>
              Shown under the title in search results and link previews. Up to 200 characters ({value.length} used).
            </FieldDescription>
            <Textarea
              id={id}
              ref={field.ref}
              name={field.name}
              rows={3}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              aria-invalid={fieldState.invalid}
              aria-describedby={describedBy("seoDescription", true, Boolean(fieldState.error))}
            />
            <FieldError id={`${id}-error`} errors={[fieldState.error]} />
          </Field>
        );
      }}
    />
  );
}

export function PageForm({ page }: { page: PageFormPage | null }) {
  const router = useRouter();
  const initial = React.useMemo<PageFormValues>(
    () => ({
      title: page?.title ?? "",
      slug: page?.slug ?? "",
      seoDescription: page?.seoDescription ?? "",
      seoImage: page?.seoImage ?? null,
    }),
    [page],
  );
  const form = useForm<PageFormValues>({
    resolver: zodResolver(pageFormSchema),
    values: initial,
    // When the page reloads (after Publish, Archive...), fields the person has changed keep their text.
    resetOptions: { keepDirtyValues: true },
    mode: "onBlur",
  });
  const { control, formState } = form;
  const { dialog: leaveDialog, allowNavigation } = useUnsavedChanges(formState.isDirty);

  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [general, setGeneral] = React.useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = React.useState(false);
  const [focusTick, setFocusTick] = React.useState(0);
  const [busy, setBusy] = React.useState<null | "publish" | "unpublish" | "archive" | "restore">(null);
  const [notice, setNotice] = React.useState<{ text: string; isError: boolean } | null>(null);
  const summaryRef = React.useRef<HTMLDivElement>(null);
  // A new page's address follows its title until the person edits the address themselves.
  const slugTouched = React.useRef(Boolean(page));

  const title = useWatch({ control, name: "title" });
  React.useEffect(() => {
    if (!slugTouched.current) form.setValue("slug", slugify(title ?? ""), { shouldDirty: true });
  }, [title, form]);

  const items: SummaryItem[] = PAGE_FIELD_ORDER.flatMap((name) => {
    const message = formState.errors[name]?.message;
    return message ? [{ name, label: PAGE_FIELD_LABELS[name], message }] : [];
  });
  const showSummary = summaryOpen && (items.length > 0 || general !== null);

  React.useEffect(() => {
    if (focusTick > 0) summaryRef.current?.focus();
  }, [focusTick]);

  function problems() {
    setSummaryOpen(true);
    setFocusTick((tick) => tick + 1);
  }

  function goTo(name: string) {
    const element = document.getElementById(fieldId(name));
    const target = element?.matches("input, textarea, button")
      ? element
      : element?.querySelector<HTMLElement>("input, textarea, button");
    (target ?? element)?.focus();
  }

  async function onValid(values: PageFormValues, event?: React.BaseSyntheticEvent) {
    // Which submit button was used: plain save, or save and go to the page builder.
    const submitter = (event?.nativeEvent as SubmitEvent | undefined)?.submitter;
    const toBuilder = submitter?.dataset.intent === "builder";
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setGeneral(null);
    const result = await savePageDetailsAction(page?.id ?? null, toPageInput(values));
    setSaving(false);

    if (result.ok) {
      setSummaryOpen(false);
      // What was just saved is the new clean state, so nothing counts as unsaved any more.
      form.reset(values);
      if (toBuilder) {
        allowNavigation();
        router.push(`/edit/${result.data.id}`);
      } else if (page) {
        setSaved(true);
        router.refresh();
      } else {
        allowNavigation();
        router.push(`/admin/pages/${result.data.id}`);
      }
      return;
    }

    const unplaced: string[] = [];
    for (const [key, message] of Object.entries(result.fieldErrors ?? {})) {
      const name = pageFormFieldFor(key);
      if (name) form.setError(name as PageFormField, { type: "server", message });
      else unplaced.push(`${key}: ${message}`);
    }
    setGeneral(result.fieldErrors ? (unplaced.length > 0 ? unplaced.join(" ") : null) : result.error);
    problems();
  }

  async function run(kind: NonNullable<typeof busy>, action: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    if (busy || !page) return;
    setBusy(kind);
    setNotice(null);
    const result = await action();
    setBusy(null);
    setNotice(result.ok ? { text: done, isError: false } : { text: result.error, isError: true });
    if (result.ok) router.refresh();
  }

  const archived = page?.archived ?? false;
  // View-only roles (audit) see the settings and status but change nothing (the server refuses too).
  const viewOnly = useViewOnly();
  // The homepage keeps its address and is never archived (the server refuses both too).
  const isHome = page?.slug === "home";
  // The homepage and the Pets page keep their address and are never archived.
  const isSystem = page ? isSystemPageSlug(page.slug) : false;
  const live = page && !archived && page.status === "published";
  const dirty = formState.isDirty;

  return (
    <form noValidate aria-label={page ? `Settings for ${page.title}` : "New page"} onSubmit={form.handleSubmit(onValid, problems)}>
      {showSummary ? (
        <ErrorSummary
          ref={summaryRef}
          items={items}
          general={general}
          onSelect={goTo}
          idOf={fieldId}
          failureTitle="The page could not be saved"
        />
      ) : null}

      {archived ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-4">
          <p className="text-sm">
            <span className="font-medium">This page is archived.</span> It is off the site and cannot be changed until it
            is restored.
          </p>
          {viewOnly ? null : (
            <Button
              type="button"
              variant="outline"
              aria-disabled={busy !== null}
              onClick={() => run("restore", () => restorePageAction(page!.id), "Page restored.")}
            >
              {busy === "restore" ? "Restoring…" : "Restore page"}
            </Button>
          )}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* disabled on the fieldset: an archived page is read-only (the server refuses changes too). */}
        <fieldset disabled={archived || viewOnly} className="m-0 min-w-0 border-0 p-0">
          <FieldGroup>
            <TextInputField control={control} name="title" label="Title" required />
            <TextInputField
              control={control}
              name="slug"
              label="Address"
              required
              prefix="/"
              readOnly={isSystem}
              description={
                isHome
                  ? "This is the homepage, shown at the site's main address. Its address cannot change."
                  : isSystem
                  ? "This is the Pets page, shown at /pets. Its address cannot change."
                  : 'Lowercase letters, numbers and dashes. Use "home" for the homepage.' +
                    (page ? " Changing it breaks links to the old address." : " Filled in from the title until you change it.")
              }
              onEdited={() => {
                slugTouched.current = true;
              }}
            />
            {!archived && !viewOnly ? (
              // The page's blocks are made in the page builder. With unsaved changes here (or on a
              // new page) the button saves first, so nothing typed above is lost.
              <div role="group" aria-labelledby="page-builder-label" className="flex flex-col gap-2">
                <p id="page-builder-label" className="text-sm font-medium">
                  Layout
                </p>
                <p id="page-builder-description" className="text-sm text-muted-foreground">
                  {page?.hasLayout
                    ? "The blocks on this page are arranged in the page builder."
                    : "This page has no blocks yet. Add them in the page builder."}
                  {page && dirty ? " Your changes here are saved first." : ""}
                  {!page ? " The page is created first." : ""}
                </p>
                <div>
                  {page && !dirty ? (
                    <Link
                      href={`/edit/${page.id}`}
                      aria-describedby="page-builder-description"
                      className={buttonVariants({ variant: "outline" })}
                    >
                      Open page builder
                    </Link>
                  ) : (
                    <Button
                      type="submit"
                      variant="outline"
                      data-intent="builder"
                      aria-disabled={saving}
                      aria-describedby="page-builder-description"
                    >
                      {page ? "Save and open page builder" : "Create and open page builder"}
                    </Button>
                  )}
                </div>
              </div>
            ) : null}
            <FieldSet>
              <FieldLegend>Search and sharing</FieldLegend>
              <FieldGroup>
                <DescriptionField control={control} />
                <ShareImageField control={control} />
              </FieldGroup>
            </FieldSet>
          </FieldGroup>
        </fieldset>

        {page ? (
          <aside aria-labelledby="page-sidebar-heading">
            <Card>
              <CardHeader>
                <h2 id="page-sidebar-heading" className="text-base font-semibold">
                  Publishing
                </h2>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    status={archived ? "archived" : page.status}
                    label={archived ? "Archived" : page.status === "published" ? "Published" : "Draft"}
                  />
                  {page.hasUnpublishedChanges && !archived ? (
                    <span className="text-muted-foreground">Unpublished changes</span>
                  ) : null}
                </div>
                {live ? (
                  <a
                    href={pagePath(page.slug)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                  >
                    View the live page
                    <FiExternalLink aria-hidden />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : null}
                {isSystem && !archived ? (
                  <p className="text-muted-foreground">
                    {isHome
                      ? "This is the homepage. If you unpublish it, the site shows its built-in homepage instead."
                      : "This is the Pets page. If you unpublish it, /pets shows the built-in catalogue instead."}
                  </p>
                ) : null}
                {!page.hasLayout && !archived ? (
                  <p className="text-muted-foreground">No layout yet. Open the page builder to add blocks before publishing.</p>
                ) : null}

                {!archived && !viewOnly ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {page.hasLayout && (page.status !== "published" || page.hasUnpublishedChanges) ? (
                      <Button
                        type="button"
                        aria-disabled={busy !== null}
                        onClick={() => run("publish", () => publishPageAction(page.id), "Published. The live page is updated.")}
                      >
                        {busy === "publish" ? "Publishing…" : page.status === "published" ? "Publish changes" : "Publish"}
                      </Button>
                    ) : null}
                    {page.status === "published" ? (
                      <Button
                        type="button"
                        variant="outline"
                        aria-disabled={busy !== null}
                        onClick={() => run("unpublish", () => unpublishPageAction(page.id), "Unpublished. The page is off the site; its draft is kept.")}
                      >
                        {busy === "unpublish" ? "Unpublishing…" : "Unpublish"}
                      </Button>
                    ) : null}
                    {isSystem ? null : (
                    <Button
                      type="button"
                      variant="outline"
                      aria-disabled={busy !== null}
                      onClick={() =>
                        run("archive", () => archivePageAction(page.id), "Archived. Restore it here or from the pages list, or delete it there.")
                      }
                    >
                      {busy === "archive" ? "Archiving…" : "Archive"}
                    </Button>
                    )}
                  </div>
                ) : null}
                <p role="status" aria-live="polite" className={cn(notice?.isError && "text-destructive")}>
                  {notice?.text ?? ""}
                </p>
              </CardContent>
            </Card>
          </aside>
        ) : null}
      </div>

      {/* The form's actions: save, and back to the list. (The page builder is opened from the form.) */}
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-4">
        {!archived && !viewOnly ? (
          // aria-disabled, not disabled: a disabled button would drop keyboard focus mid-save.
          <Button type="submit" data-intent="save" aria-disabled={saving} className={cn(saving && "opacity-50")}>
            {page ? "Save changes" : "Create page"}
          </Button>
        ) : null}
        <Link href="/admin/pages" className={buttonVariants({ variant: "ghost" })}>
          {page ? "Back to pages" : "Cancel"}
        </Link>
        <p role="status" aria-live="polite" className="text-sm">
          {saving ? "Saving…" : saved && !dirty ? "Saved." : ""}
        </p>
      </div>
      {leaveDialog}
    </form>
  );
}
