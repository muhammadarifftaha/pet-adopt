"use client";
import React from "react";
import { usePathname } from "next/navigation";
import { createSerializer, debounce, useQueryStates } from "nuqs";
import useSWR from "swr";
import {
  InputGroup,
  InputGroupButton,
  InputGroupInput,
} from "@pet-adopt/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectValue,
  SelectTrigger,
} from "@pet-adopt/ui/components/select";
import { FiSearch } from "react-icons/fi";
import { petSearchParsers } from "@/app/(admin)/admin/pets/search-params";
import { SPECIES_CACHE_KEY } from "@/lib/admin/pets-cache";
import { unwrapResult } from "@/lib/admin/unwrap-client";
import { usePetList, type PetListSeed } from "@/lib/admin/use-pet-list";
import { isPetStatus, type Option, PET_STATUS_VALUES } from "@/lib/options";
import { listSpeciesOptionsAction } from "@/server/actions/pets";
import { capitalize } from "es-toolkit";
import PetPagination from "./PetPagination";

// How long to wait after the last keystroke before the URL (and so the list) updates.
const SEARCH_DEBOUNCE_MS = 300;

// Builds a pager link such as /admin/pets?search=mochi&page=2 (a page of 1 is left out).
const serialize = createSerializer(petSearchParsers);

export default function FilterBar({
  speciesOptions: initialSpeciesOptions,
  initialFilters,
  initialData,
}: PetListSeed & {
  /** The species as the server saw them when the page opened: the first render, before SWR takes over. */
  speciesOptions: Option[];
}) {
  // The pager needs the page count, which PetList fetches. Same SWR key, so it is one request.
  // `keepPreviousData` keeps the last count while a new page loads, so the pager does not blink out.
  const { data } = usePetList({
    initialFilters,
    initialData,
    keepPreviousData: true,
  });
  const pathname = usePathname();

  // Cached and refetched on each visit, so a species added since the page opened shows up. If the
  // fetch fails, the server's list stays.
  const { data: speciesOptions = initialSpeciesOptions } = useSWR(
    SPECIES_CACHE_KEY,
    async () => unwrapResult(await listSpeciesOptionsAction()),
    { fallbackData: initialSpeciesOptions },
  );

  // One hook for every filter, so a change can send the page back to 1 in the same URL update
  // (a new search on page 3 of the old results would otherwise show an empty page).
  // nuqs's default `shallow` is kept on purpose: the URL changes without asking the server, and
  // PetList reads the URL and fetches the rows with SWR, so the page never refreshes.
  // The returned state changes immediately; only the URL write is delayed, so the input never lags
  // (and PetList only fetches once the URL has changed, not on every keystroke).
  const [filters, setFilters] = useQueryStates(petSearchParsers);

  return (
    <div className="flex flex-row flex-wrap justify-between items-center gap-4 pb-6">
      <form
        role="search"
        className="flex flex-row justify-start items-center gap-2"
        onSubmit={(e) => {
          // Enter or the search button: skip the wait and update the URL now.
          e.preventDefault();
          setFilters({ search: filters.search, page: 1 });
        }}
      >
        <InputGroup className="max-w-md">
          <InputGroupInput
            type="search"
            name="search"
            aria-label="Search pets"
            placeholder="Search..."
            value={filters.search}
            onChange={(e) =>
              setFilters(
                { search: e.target.value, page: 1 },
                { limitUrlUpdates: debounce(SEARCH_DEBOUNCE_MS) },
              )
            }
          />
          <InputGroupButton type="submit" aria-label="Search">
            <FiSearch className="h-4 w-4" />
          </InputGroupButton>
        </InputGroup>
        <Select
          value={filters.status}
          onValueChange={(value) =>
            setFilters({ status: isPetStatus(value) ? value : null, page: 1 })
          }
        >
          <SelectTrigger className="w-3xs" aria-label="Status">
            <SelectValue placeholder="Status" className="capitalize" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Status</SelectLabel>
              <SelectItem value={null}>Any</SelectItem>
              {PET_STATUS_VALUES.map((status) => (
                <SelectItem key={status} value={status}>
                  {capitalize(status)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          value={filters.species}
          onValueChange={(value) =>
            setFilters({ species: value || null, page: 1 })
          }
        >
          <SelectTrigger className="w-3xs" aria-label="Species">
            <SelectValue placeholder="Species" className="capitalize" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Species</SelectLabel>
              <SelectItem value={null}>Any</SelectItem>
              {speciesOptions.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {capitalize(label)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </form>
      <PetPagination
        page={filters.page}
        totalPages={data?.totalPages ?? 1}
        hrefFor={(page) => serialize(pathname, { ...filters, page })}
        onPageChange={(page) => setFilters({ page })}
      />
    </div>
  );
}
