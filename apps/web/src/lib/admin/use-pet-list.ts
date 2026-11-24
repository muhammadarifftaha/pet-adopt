"use client";

import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import type { inferParserType } from "nuqs/server";
import {
  loadPetSearchParams,
  petSearchParsers,
} from "@/app/(admin)/admin/pets/search-params";
import { listPetsAction } from "@/server/actions/pets";
import type { PetPage } from "@/server/types";
import { PETS_CACHE_KEY } from "./pets-cache";
import { unwrapResult } from "./unwrap-client";

export type PetListFilters = inferParserType<typeof petSearchParsers>;

/** What the server page loaded for the URL it was opened with: the first render's filters and rows. */
export type PetListSeed = {
  initialFilters: PetListFilters;
  initialData: PetPage;
};

// The SWR key: one entry per filter, so every combination is cached on its own.
const keyOf = (f: PetListFilters) =>
  [PETS_CACHE_KEY, f.search, f.status, f.species, f.page] as const;

/**
 * The admin pet list for the URL as it is now (FilterBar writes the filters, debounced), fetched
 * and cached with SWR. PetList and FilterBar's pager both call it: SWR sees the same key and makes
 * one request. `keepPreviousData` keeps the last rows while a new key loads; PetList leaves it off
 * so it can show a skeleton, the pager turns it on so the page count does not blink out.
 */
export function usePetList({
  initialFilters,
  initialData,
  keepPreviousData = false,
}: PetListSeed & { keepPreviousData?: boolean }) {
  const filters = loadPetSearchParams(useSearchParams());
  const key = keyOf(filters);
  // The server's data is only right for the URL it was rendered for, so it only seeds that key.
  const isInitial = JSON.stringify(key) === JSON.stringify(keyOf(initialFilters));

  const result = useSWR(
    key,
    async ([, search, status, species, page]) =>
      unwrapResult(
        await listPetsAction({
          search,
          status: status ?? undefined,
          species: species ?? undefined,
          page,
        }),
      ),
    { fallbackData: isInitial ? initialData : undefined, keepPreviousData },
  );

  return { filters, ...result };
}
