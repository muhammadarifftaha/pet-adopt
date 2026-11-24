"use client";

import React from "react";
import { Controller, useWatch } from "react-hook-form";

import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@pet-adopt/ui/components/field";
import { RadioGroup, RadioGroupItem } from "@pet-adopt/ui/components/radio-group";
import { todayISO } from "@/lib/age";
import { AGE_GROUPS, AGE_UNITS } from "@/lib/options";

import { SelectField, TextField, fieldId, type FormControl } from "./fields";

type Mode = "keep" | "date" | "estimate" | "none";

// How the age is entered. The pet's age is stored as a birth date and worked out when it is shown,
// so it keeps up with time. Two ways to give it, "keep what is there", or "not known".
// A radio group (one choice out of a few) reveals only the fields of the chosen way.
export function AgeFields({
  control,
  hasBirthDate,
  currentAge,
}: {
  control: FormControl;
  /** The pet being edited already has a birth date, so "keep" is offered. */
  hasBirthDate: boolean;
  currentAge: string | null;
}) {
  const mode = useWatch({ control, name: "ageMode" }) as Mode;
  const legendId = "pet-ageMode-legend";

  const choices: Array<{ value: Mode; label: string }> = [
    ...(hasBirthDate
      ? [{ value: "keep" as const, label: `Keep the current age${currentAge ? ` (${currentAge})` : ""}` }]
      : []),
    { value: "date", label: "I know the birth date" },
    { value: "estimate", label: "I know about how old it is" },
    { value: "none", label: "I do not know the age" },
  ];

  return (
    <FieldSet id={fieldId("ageMode")}>
      <FieldLegend id={legendId} variant="label">
        Age
      </FieldLegend>
      <FieldDescription id="pet-ageMode-description">
        Enter it once. It is kept as a birth date, so the age on the site keeps up with time.
      </FieldDescription>

      <Controller
        name="ageMode"
        control={control}
        render={({ field }) => (
          <RadioGroup
            aria-labelledby={legendId}
            aria-describedby="pet-ageMode-description"
            value={field.value}
            onValueChange={(value) => field.onChange(String(value))}
            onBlur={field.onBlur}
          >
            {choices.map((choice) => {
              const id = `pet-ageMode-${choice.value}`;
              return (
                // w-fit: the row is only as wide as the radio and its text, so empty space beside it
                // does not select the choice (a horizontal Field would stretch the label across the row).
                <Field orientation="horizontal" key={choice.value} className="w-fit">
                  <RadioGroupItem
                    id={id}
                    value={choice.value}
                    aria-labelledby={`${id}-label`}
                    className="cursor-pointer"
                  />
                  <FieldLabel id={`${id}-label`} htmlFor={id} className="cursor-pointer font-normal">
                    {choice.label}
                  </FieldLabel>
                </Field>
              );
            })}
          </RadioGroup>
        )}
      />

      {mode === "date" ? (
        <TextField
          control={control}
          name="birthDate"
          label="Birth date"
          description="The pet cannot be born in the future."
          type="date"
          max={todayISO()}
        />
      ) : null}

      {mode === "estimate" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            control={control}
            name="ageValue"
            label="About how old"
            description="A whole number, for example 8."
            inputMode="numeric"
          />
          <SelectField
            control={control}
            name="ageUnit"
            label="In"
            description="Weeks, months or years."
            options={AGE_UNITS}
            allowEmpty={false}
          />
        </div>
      ) : null}

      {mode === "none" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            control={control}
            name="ageDescription"
            label="Age, in your own words"
            description="For example “a young adult”. Up to 40 characters."
          />
          <SelectField
            control={control}
            name="ageGroup"
            label="Age group"
            description="Used by the age filter on the site."
            options={AGE_GROUPS}
          />
        </div>
      ) : null}
    </FieldSet>
  );
}
