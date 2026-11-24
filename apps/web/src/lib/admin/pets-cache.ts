"use client";

import { useSWRConfig } from "swr";

/**
 * First entry of every SWR key that holds pet data: the list is ["pets", search, status, species, page]
 * and the species dropdown is ["pets", "species"]. One matcher (below) covers both.
 */
export const PETS_CACHE_KEY = "pets";

/** The species the dropdowns offer (built-in and custom). A save can add one, so it is invalidated with the lists. */
export const SPECIES_CACHE_KEY = [PETS_CACHE_KEY, "species"] as const;

/**
 * Marks every cached pet list, and the species dropdown, as out of date and refetches the ones on screen. Call it after
 * anything that changes pets from the client (save, delete): SWR's cache lives in the browser, so
 * the server's `revalidatePath` does not reach it.
 */
export function useInvalidatePets() {
  const { mutate } = useSWRConfig();
  return () => mutate((key) => Array.isArray(key) && key[0] === PETS_CACHE_KEY);
}
