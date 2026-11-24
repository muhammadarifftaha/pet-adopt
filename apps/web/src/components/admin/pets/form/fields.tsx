"use client";

import React from "react";
import { Controller, type Control } from "react-hook-form";

import { Checkbox } from "@pet-adopt/ui/components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@pet-adopt/ui/components/field";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@pet-adopt/ui/components/combobox";
import { Input } from "@pet-adopt/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pet-adopt/ui/components/select";
import { Textarea } from "@pet-adopt/ui/components/textarea";
import type { Option } from "@/lib/options";
import type { PetFormValues } from "@/lib/zod-schema/pet";

// The pet form's field components. Each one gives a control what WCAG asks for:
//  - a visible label tied to the control (1.3.1, 3.3.2) and a text "(required)" mark, not colour alone;
//  - its hint and its error tied with aria-describedby, and aria-invalid when it has an error (3.3.1);
//  - groups of related controls in a fieldset with a legend (1.3.1).
// The ids are predictable (`fieldId`) so the error summary can link to, and focus, any field.

export type FormControl = Control<PetFormValues>;

type FieldsOf<T> = {
  [K in keyof PetFormValues]: PetFormValues[K] extends T ? K : never;
}[keyof PetFormValues];

export type StringField = FieldsOf<string>;
export type BooleanField = FieldsOf<boolean>;
export type StringListField = "temperament" | "goodWith";

/** The DOM id of a field (or of the fieldset around a group). */
export const fieldId = (name: string) => `pet-${name}`;

const FOCUSABLE =
  "[role='checkbox'], [role='radio'], [role='combobox'], button:not([disabled]), input:not([type='hidden']), select, textarea";

/** Moves focus to a field, or to the first control inside a group. Used by the error summary. */
export function focusField(name: string) {
  const element = document.getElementById(fieldId(name));
  if (!element) return;
  const target = element.matches(FOCUSABLE) ? element : element.querySelector<HTMLElement>(FOCUSABLE);
  (target ?? element).focus();
}

function Required() {
  return <span className="font-normal text-muted-foreground"> (required)</span>;
}

function describedBy(name: string, hasDescription: boolean, hasError: boolean) {
  const ids = [
    hasDescription ? `${fieldId(name)}-description` : null,
    hasError ? `${fieldId(name)}-error` : null,
  ].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

type Common = {
  control: FormControl;
  label: string;
  description?: string;
  required?: boolean;
};

export function TextField({
  control,
  name,
  label,
  description,
  required,
  type = "text",
  inputMode,
  autoComplete = "off",
  list,
  max,
}: Common & {
  name: StringField;
  type?: React.ComponentProps<"input">["type"];
  inputMode?: React.ComponentProps<"input">["inputMode"];
  autoComplete?: string;
  /** The id of a <datalist> with suggestions. */
  list?: string;
  max?: string;
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const id = fieldId(name);
        return (
          <Field data-invalid={fieldState.invalid || undefined}>
            <FieldLabel htmlFor={id}>
              {label}
              {required ? <Required /> : null}
            </FieldLabel>
            {description ? (
              <FieldDescription id={`${id}-description`}>{description}</FieldDescription>
            ) : null}
            <Input
              id={id}
              ref={field.ref}
              name={field.name}
              type={type}
              inputMode={inputMode}
              autoComplete={autoComplete}
              list={list}
              max={max}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              aria-invalid={fieldState.invalid}
              aria-required={required || undefined}
              aria-describedby={describedBy(name, Boolean(description), Boolean(fieldState.error))}
            />
            <FieldError id={`${id}-error`} errors={[fieldState.error]} />
          </Field>
        );
      }}
    />
  );
}

/**
 * A text box with a list of suggestions (a combobox) that also accepts anything typed: species is free
 * text. The text in the box IS the value, so a custom species needs nothing extra; picking a suggestion
 * just fills the box. The list narrows as you type and the field keeps its label, hint and error wiring.
 */
export function SpeciesField({
  control,
  name,
  label,
  description,
  required,
  options,
}: Common & {
  name: StringField;
  /** Display labels of the species to suggest. */
  options: string[];
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const id = fieldId(name);
        return (
          <Field data-invalid={fieldState.invalid || undefined}>
            <FieldLabel htmlFor={id}>
              {label}
              {required ? <Required /> : null}
            </FieldLabel>
            {description ? (
              <FieldDescription id={`${id}-description`}>{description}</FieldDescription>
            ) : null}
            <Combobox
              items={options}
              // The selection is not tracked: the typed text is the value.
              value={null}
              inputValue={field.value}
              // Take the text only when the person changed it (typing or pasting, picking an item). The
              // combobox also resets its own text on blur and close because nothing is "selected" (we
              // do not track a selection), and that reset would wipe a typed or existing species.
              onInputValueChange={(text, details) => {
                if (details.reason === "input-change" || details.reason === "item-press") {
                  field.onChange(text);
                }
              }}
              onValueChange={(item) => {
                if (typeof item === "string") field.onChange(item);
              }}
              autoHighlight={false}
            >
              <ComboboxInput
                id={id}
                ref={field.ref}
                name={field.name}
                autoComplete="off"
                placeholder="Pick or type a species"
                onBlur={field.onBlur}
                aria-invalid={fieldState.invalid}
                aria-required={required || undefined}
                aria-describedby={describedBy(name, Boolean(description), Boolean(fieldState.error))}
              />
              <ComboboxContent>
                <ComboboxEmpty>
                  {field.value.trim() ? `No match: “${field.value.trim()}” will be added as a new species.` : "No species yet."}
                </ComboboxEmpty>
                <ComboboxList>
                  {(item: string) => (
                    <ComboboxItem key={item} value={item}>
                      {item}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <FieldError id={`${id}-error`} errors={[fieldState.error]} />
          </Field>
        );
      }}
    />
  );
}

export function TextareaField({
  control,
  name,
  label,
  description,
  required,
  rows = 4,
}: Common & { name: StringField; rows?: number }) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const id = fieldId(name);
        return (
          <Field data-invalid={fieldState.invalid || undefined}>
            <FieldLabel htmlFor={id}>
              {label}
              {required ? <Required /> : null}
            </FieldLabel>
            {description ? (
              <FieldDescription id={`${id}-description`}>{description}</FieldDescription>
            ) : null}
            <Textarea
              id={id}
              ref={field.ref}
              name={field.name}
              rows={rows}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              aria-invalid={fieldState.invalid}
              aria-required={required || undefined}
              aria-describedby={describedBy(name, Boolean(description), Boolean(fieldState.error))}
            />
            <FieldError id={`${id}-error`} errors={[fieldState.error]} />
          </Field>
        );
      }}
    />
  );
}

export function SelectField({
  control,
  name,
  label,
  description,
  required,
  options,
  allowEmpty = true,
  emptyLabel = "Not set",
}: Common & {
  name: StringField;
  options: readonly Option[];
  /** Offer an entry that clears the field. Off for a select that must have a value. */
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  // `items` lets the trigger show an option's label instead of its stored value.
  const items: Array<{ value: string | null; label: string }> = [
    ...(allowEmpty ? [{ value: null, label: emptyLabel }] : []),
    ...options.map((option) => ({ value: option.value, label: option.label })),
  ];

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const id = fieldId(name);
        return (
          <Field data-invalid={fieldState.invalid || undefined}>
            <FieldLabel htmlFor={id}>
              {label}
              {required ? <Required /> : null}
            </FieldLabel>
            {description ? (
              <FieldDescription id={`${id}-description`}>{description}</FieldDescription>
            ) : null}
            <Select
              items={items}
              value={field.value || null}
              onValueChange={(value) => field.onChange(value ?? "")}
            >
              <SelectTrigger
                id={id}
                ref={field.ref}
                onBlur={field.onBlur}
                className="w-full"
                aria-invalid={fieldState.invalid}
                aria-required={required || undefined}
                aria-describedby={describedBy(name, Boolean(description), Boolean(fieldState.error))}
              >
                <SelectValue placeholder={emptyLabel} />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.value ?? "empty"} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id={`${id}-error`} errors={[fieldState.error]} />
          </Field>
        );
      }}
    />
  );
}

export function CheckboxField({
  control,
  name,
  label,
  description,
}: Omit<Common, "required"> & { name: BooleanField }) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => {
        const id = fieldId(name);
        return (
          <Field orientation="horizontal">
            <Checkbox
              id={id}
              ref={field.ref}
              name={field.name}
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked)}
              onBlur={field.onBlur}
              aria-labelledby={`${id}-label`}
              aria-describedby={description ? `${id}-description` : undefined}
            />
            <FieldContent>
              <FieldLabel id={`${id}-label`} htmlFor={id} className="font-normal">
                {label}
              </FieldLabel>
              {description ? (
                <FieldDescription id={`${id}-description`}>{description}</FieldDescription>
              ) : null}
            </FieldContent>
          </Field>
        );
      }}
    />
  );
}

/** Several checkboxes that make a list of values (temperament, good with), in a fieldset. */
export function CheckboxGroupField({
  control,
  name,
  label,
  description,
  options,
}: Omit<Common, "required"> & { name: StringListField; options: readonly Option[] }) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const id = fieldId(name);
        const selected = field.value as string[];
        return (
          <FieldSet
            id={id}
            data-invalid={fieldState.invalid || undefined}
            aria-describedby={describedBy(name, Boolean(description), Boolean(fieldState.error))}
          >
            <FieldLegend variant="label">{label}</FieldLegend>
            {description ? (
              <FieldDescription id={`${id}-description`}>{description}</FieldDescription>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              {options.map((option, index) => {
                const optionId = `${id}-${option.value}`;
                return (
                  <Field orientation="horizontal" key={option.value}>
                    <Checkbox
                      id={optionId}
                      ref={index === 0 ? field.ref : undefined}
                      checked={selected.includes(option.value)}
                      onCheckedChange={(checked) =>
                        field.onChange(
                          checked
                            ? [...selected, option.value]
                            : selected.filter((value) => value !== option.value),
                        )
                      }
                      onBlur={field.onBlur}
                      aria-labelledby={`${optionId}-label`}
                    />
                    <FieldLabel id={`${optionId}-label`} htmlFor={optionId} className="font-normal">
                      {option.label}
                    </FieldLabel>
                  </Field>
                );
              })}
            </div>
            <FieldError id={`${id}-error`} errors={[fieldState.error]} />
          </FieldSet>
        );
      }}
    />
  );
}
