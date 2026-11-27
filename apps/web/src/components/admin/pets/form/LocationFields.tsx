"use client";

import React from "react";
import { Controller, useWatch } from "react-hook-form";
import useSWR from "swr";
import { foldText } from "@pet-adopt/plugin-sdk";

import { Button } from "@pet-adopt/ui/components/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@pet-adopt/ui/components/combobox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@pet-adopt/ui/components/field";
import { unwrapResult } from "@/lib/admin/unwrap-client";
import { cityChoices, matchPlaces, type CityChoice, type PlaceCountry } from "@/lib/places";
import { listPlaceCountriesAction, listPlacesAction } from "@/server/actions/places";

import { describedBy, fieldId, type FormControl } from "./fields";

// The pet form's Country, City and State. The country is picked from a list and starts as the
// site's own (Site settings), so most pets never need it touched; it chooses which cities and
// states are suggested. City and State stay free text, like Species: the text in the box IS the
// value, so a village the list does not know can simply be typed. Picking a city fills its state.

// The lists only change with a release of the site, so one read per visit is enough.
const ONCE = { revalidateOnFocus: false, revalidateIfStale: false, revalidateOnReconnect: false } as const;

function matchesCountry(country: PlaceCountry, query: string) {
  const term = foldText(query).trim();
  return !term || foldText(country.name).includes(term) || country.code.toLowerCase() === term;
}

/** What the open list says when it has nothing to show. */
function emptyText(typed: string, kind: "city" | "state", loading: boolean, failed: boolean) {
  if (loading) return "Loading suggestions…";
  const value = typed.trim();
  if (failed) return `The suggestions could not be loaded. Type the ${kind} instead.`;
  return value ? `No match: “${value}” will be used as typed.` : `Nothing to suggest. Type the ${kind}.`;
}

export function LocationFields({ control }: { control: FormControl }) {
  // The values are watched here for the suggestion lists; the boxes themselves are wired by the
  // Controllers below (a field's ref and handlers are only read inside their render callbacks).
  const [cityValue, stateValue, code] = useWatch({ control, name: ["city", "state", "country"] });

  const countries = useSWR(["places", "countries"], async () => unwrapResult(await listPlaceCountriesAction()), ONCE);
  // No country (a pet whose country was cleared): nothing is suggested, and both boxes still take text.
  const places = useSWR(code ? ["places", code] : null, async () => unwrapResult(await listPlacesAction(code)), ONCE);

  const country = countries.data?.find((entry) => entry.code === code) ?? null;
  const loading = places.isLoading;
  const failed = Boolean(places.error);

  const allCities = React.useMemo(
    () => (places.data ? cityChoices(places.data, stateValue) : []),
    [places.data, stateValue],
  );
  const cityMatches = React.useMemo(
    () => matchPlaces(allCities, (choice) => choice.city, cityValue),
    [allCities, cityValue],
  );
  const stateMatches = React.useMemo(
    () => matchPlaces(places.data?.states ?? [], (name) => name, stateValue),
    [places.data, stateValue],
  );

  const countryId = fieldId("country");
  const cityId = fieldId("city");
  const stateId = fieldId("state");

  return (
    <>
      <Controller
        name="country"
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid || undefined}>
            <FieldLabel htmlFor={countryId}>Country</FieldLabel>
            <FieldDescription id={`${countryId}-description`}>
              Starts as the site&apos;s country. Change it for a pet that is somewhere else; its page then names the country.
            </FieldDescription>
            <Combobox
              items={countries.data ?? []}
              value={country}
              onValueChange={(picked: PlaceCountry | null) => {
                if (picked) field.onChange(picked.code);
              }}
              itemToStringLabel={(item: PlaceCountry) => item.name}
              itemToStringValue={(item: PlaceCountry) => item.code}
              isItemEqualToValue={(a: PlaceCountry, b: PlaceCountry) => a.code === b.code}
              filter={(item: PlaceCountry, query: string) => matchesCountry(item, query)}
            >
              <ComboboxTrigger
                id={countryId}
                ref={field.ref}
                onBlur={field.onBlur}
                render={<Button type="button" variant="outline" className="w-full justify-between gap-2 px-2.5 font-normal" />}
                aria-invalid={fieldState.invalid || undefined}
                aria-describedby={describedBy("country", true, Boolean(fieldState.error))}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {country ? <span aria-hidden="true">{country.flag}</span> : null}
                  <span className="truncate">
                    {country ? country.name : countries.error ? "Countries could not be loaded" : code || "Pick a country"}
                  </span>
                </span>
              </ComboboxTrigger>
              <ComboboxContent>
                <ComboboxInput showTrigger={false} placeholder="Search countries" aria-label="Search countries" />
                <ComboboxEmpty>{countries.isLoading ? "Loading countries…" : "No country matches."}</ComboboxEmpty>
                <ComboboxList>
                  {(item: PlaceCountry) => (
                    <ComboboxItem key={item.code} value={item}>
                      <span aria-hidden="true">{item.flag}</span>
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <FieldError id={`${countryId}-error`} errors={[fieldState.error]} />
          </Field>
        )}
      />

      <Controller
        name="state"
        control={control}
        render={({ field: state, fieldState: stateState }) => (
          <Controller
            name="city"
            control={control}
            render={({ field: city, fieldState: cityState }) => (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={cityState.invalid || undefined}>
                  <FieldLabel htmlFor={cityId}>City</FieldLabel>
                  <Combobox
                    items={cityMatches}
                    // The list is already narrowed (matchPlaces): a country can have thousands of cities.
                    filter={null}
                    // The selection is not tracked: the typed text is the value (see SpeciesField).
                    value={null}
                    inputValue={city.value}
                    onInputValueChange={(text, details) => {
                      if (details.reason === "input-change" || details.reason === "item-press") city.onChange(text);
                    }}
                    onValueChange={(picked: CityChoice | null) => {
                      if (!picked) return;
                      city.onChange(picked.city);
                      if (picked.state) state.onChange(picked.state);
                    }}
                    itemToStringLabel={(item: CityChoice) => item.city}
                    itemToStringValue={(item: CityChoice) => item.key}
                    autoHighlight={false}
                  >
                    <ComboboxInput
                      id={cityId}
                      ref={city.ref}
                      name={city.name}
                      autoComplete="off"
                      placeholder="Pick or type a city"
                      onBlur={city.onBlur}
                      aria-invalid={cityState.invalid}
                      aria-describedby={describedBy("city", false, Boolean(cityState.error))}
                    />
                    <ComboboxContent>
                      <ComboboxEmpty>{emptyText(city.value, "city", loading, failed)}</ComboboxEmpty>
                      <ComboboxList>
                        {(item: CityChoice) => (
                          <ComboboxItem key={item.key} value={item}>
                            <span className="min-w-0 flex-1 truncate">{item.city}</span>
                            {item.state ? <span className="truncate text-muted-foreground">{item.state}</span> : null}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  <FieldError id={`${cityId}-error`} errors={[cityState.error]} />
                </Field>

                <Field data-invalid={stateState.invalid || undefined}>
                  <FieldLabel htmlFor={stateId}>State</FieldLabel>
                  <Combobox
                    items={stateMatches}
                    filter={null}
                    value={null}
                    inputValue={state.value}
                    onInputValueChange={(text, details) => {
                      if (details.reason === "input-change" || details.reason === "item-press") state.onChange(text);
                    }}
                    onValueChange={(picked: string | null) => {
                      if (typeof picked === "string") state.onChange(picked);
                    }}
                    autoHighlight={false}
                  >
                    <ComboboxInput
                      id={stateId}
                      ref={state.ref}
                      name={state.name}
                      autoComplete="off"
                      placeholder="Pick or type a state"
                      onBlur={state.onBlur}
                      aria-invalid={stateState.invalid}
                      aria-describedby={describedBy("state", false, Boolean(stateState.error))}
                    />
                    <ComboboxContent>
                      <ComboboxEmpty>{emptyText(state.value, "state", loading, failed)}</ComboboxEmpty>
                      <ComboboxList>
                        {(item: string) => (
                          <ComboboxItem key={item} value={item}>
                            {item}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  <FieldError id={`${stateId}-error`} errors={[stateState.error]} />
                </Field>
              </div>
            )}
          />
        )}
      />
    </>
  );
}
