"use client";

import React from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@pet-adopt/ui/components/button";
import { DialogFooter } from "@pet-adopt/ui/components/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@pet-adopt/ui/components/field";
import { Input } from "@pet-adopt/ui/components/input";
import { TIMELINE_TEXT_MAX_CHARS, TIMELINE_TITLE_MAX, type TimelineEntry } from "@/lib/pet-timeline";
import { cn } from "@/lib/utils";
import {
  TIMELINE_FIELD_LABELS,
  TIMELINE_FIELD_ORDER,
  timelineEntrySchema,
  timelineFieldFor,
  timelineToFormValues,
  toTimelineInput,
  type TimelineEntryFormValues,
} from "@/lib/zod-schema/pet-timeline";
import { addPetTimelineEntryAction, updatePetTimelineEntryAction } from "@/server/actions/pet-timeline";

import { ErrorSummary, type SummaryItem } from "../form/ErrorSummary";
import { RichTextEditorField } from "../form/RichTextField";
import { TimelinePhotosField } from "./TimelinePhotosField";

// The form for one timeline update, inside the Add/Edit dialog. It saves only this entry (add or
// update): never the pet, never the other entries. React Hook Form + zod like the pet form, with the
// same accessibility choices: visible labels and a "(required)" mark, hints and errors tied with
// aria-describedby, one error summary that takes focus after a failed save (its links focus the
// field), server field errors put on their fields, and an aria-disabled save button so focus stays.

/** The DOM id of a field of this form. */
export const timelineFieldId = (name: string) => `timeline-${name}`;

const FOCUSABLE = "button:not([disabled]), input:not([type='hidden']), [role='textbox']";

function focusTimelineField(name: string) {
  const element = document.getElementById(timelineFieldId(name));
  if (!element) return;
  const target = element.matches(FOCUSABLE) ? element : element.querySelector<HTMLElement>(FOCUSABLE);
  (target ?? element).focus();
}

function Required() {
  return <span className="font-normal text-muted-foreground"> (required)</span>;
}

function describedBy(name: string, hasDescription: boolean, hasError: boolean) {
  const id = timelineFieldId(name);
  const ids = [hasDescription ? `${id}-description` : null, hasError ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export function TimelineEntryForm({
  petId,
  entry,
  today,
  onSaved,
  onCancel,
}: {
  petId: number;
  /** The update to edit, or null for a new one. */
  entry: TimelineEntry | null;
  /** Today in the site's time zone (YYYY-MM-DD): a new update's date. */
  today: string;
  onSaved: (entry: TimelineEntry) => void;
  onCancel: () => void;
}) {
  const form = useForm<TimelineEntryFormValues>({
    resolver: zodResolver(timelineEntrySchema),
    defaultValues: timelineToFormValues(entry, today),
    mode: "onBlur",
    // The error summary takes focus after a failed save (its links lead to each field).
    shouldFocusError: false,
  });
  const { control, formState } = form;

  const [saving, setSaving] = React.useState(false);
  const [general, setGeneral] = React.useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = React.useState(false);
  const [focusTick, setFocusTick] = React.useState(0);
  const summaryRef = React.useRef<HTMLDivElement>(null);

  const items: SummaryItem[] = TIMELINE_FIELD_ORDER.flatMap((name) => {
    const message = (formState.errors[name] as { message?: string } | undefined)?.message;
    return message ? [{ name, label: TIMELINE_FIELD_LABELS[name], message }] : [];
  });
  const showSummary = summaryOpen && (items.length > 0 || general !== null);

  // Focus the summary once it is on screen: React Hook Form can publish the errors one render
  // after the failed submit, so wait for the summary rather than the tick alone.
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

  async function onValid(values: TimelineEntryFormValues) {
    if (saving) return;
    setSaving(true);
    setGeneral(null);
    const input = toTimelineInput(values);
    const result = entry
      ? await updatePetTimelineEntryAction(entry.id, input)
      : await addPetTimelineEntryAction(petId, input);
    setSaving(false);

    if (result.ok) {
      onSaved(result.data);
      return;
    }
    const unplaced: string[] = [];
    for (const [key, message] of Object.entries(result.fieldErrors ?? {})) {
      const name = timelineFieldFor(key);
      if (name) form.setError(name, { type: "server", message });
      else unplaced.push(message);
    }
    setGeneral(result.fieldErrors ? (unplaced.length > 0 ? unplaced.join(" ") : null) : result.error);
    problems();
  }

  return (
    <form
      noValidate
      aria-label={entry ? "Edit update" : "Add update"}
      onSubmit={(event) => {
        // The dialog is in a portal, but React events still bubble up the component tree.
        event.stopPropagation();
        void form.handleSubmit(onValid, problems)(event);
      }}
      className="flex flex-col gap-4"
    >
      {showSummary ? (
        <ErrorSummary
          ref={summaryRef}
          items={items}
          general={general}
          idOf={timelineFieldId}
          failureTitle="The update could not be saved"
          onSelect={(name) => requestAnimationFrame(() => focusTimelineField(name))}
        />
      ) : null}

      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            name="date"
            control={control}
            render={({ field, fieldState }) => {
              const id = timelineFieldId("date");
              return (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor={id}>
                    Date
                    <Required />
                  </FieldLabel>
                  <Input
                    id={id}
                    ref={field.ref}
                    name={field.name}
                    type="date"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    aria-invalid={fieldState.invalid}
                    aria-required
                    aria-describedby={describedBy("date", false, Boolean(fieldState.error))}
                  />
                  <FieldError id={`${id}-error`} errors={[fieldState.error]} />
                </Field>
              );
            }}
          />
          <Controller
            name="time"
            control={control}
            render={({ field, fieldState }) => {
              const id = timelineFieldId("time");
              return (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor={id}>Time</FieldLabel>
                  <FieldDescription id={`${id}-description`}>Optional. The time where the pet is (the site&apos;s time zone, when one is set).</FieldDescription>
                  <Input
                    id={id}
                    ref={field.ref}
                    name={field.name}
                    type="time"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    aria-invalid={fieldState.invalid}
                    aria-describedby={describedBy("time", true, Boolean(fieldState.error))}
                  />
                  <FieldError id={`${id}-error`} errors={[fieldState.error]} />
                </Field>
              );
            }}
          />
        </div>

        <Controller
          name="title"
          control={control}
          render={({ field, fieldState }) => {
            const id = timelineFieldId("title");
            return (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor={id}>
                  Title
                  <Required />
                </FieldLabel>
                <FieldDescription id={`${id}-description`}>
                  For example “Moved to a foster home”. Up to {TIMELINE_TITLE_MAX} characters.
                </FieldDescription>
                <Input
                  id={id}
                  ref={field.ref}
                  name={field.name}
                  autoComplete="off"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  aria-invalid={fieldState.invalid}
                  aria-required
                  aria-describedby={describedBy("title", true, Boolean(fieldState.error))}
                />
                <FieldError id={`${id}-error`} errors={[fieldState.error]} />
              </Field>
            );
          }}
        />

        <Controller
          name="body"
          control={control}
          render={({ field, fieldState }) => (
            <RichTextEditorField
              name="body"
              domId={timelineFieldId("body")}
              label="Text"
              description={`Optional. Bold, italic, underline, lists and links. Up to ${TIMELINE_TEXT_MAX_CHARS} characters.`}
              maxChars={TIMELINE_TEXT_MAX_CHARS}
              value={field.value ?? null}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        <Controller
          name="photos"
          control={control}
          render={({ field, fieldState }) => (
            <TimelinePhotosField
              id={timelineFieldId("photos")}
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
              buttonRef={field.ref}
            />
          )}
        />
      </FieldGroup>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        {/* aria-disabled, not disabled: a disabled button would drop keyboard focus mid-save. */}
        <Button type="submit" aria-disabled={saving} className={cn(saving && "opacity-50")}>
          {saving ? "Saving…" : entry ? "Save update" : "Add update"}
        </Button>
      </DialogFooter>
    </form>
  );
}
