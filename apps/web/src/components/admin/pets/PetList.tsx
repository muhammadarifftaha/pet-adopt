"use client";
import React from "react";
import { EmptyState } from "@/components/admin/EmptyState";
import { Button } from "@pet-adopt/ui/components/button";
import { useInvalidatePets } from "@/lib/admin/pets-cache";
import { usePetList, type PetListSeed } from "@/lib/admin/use-pet-list";
import { PetCard } from "./PetCard";
import { PET_GRID, PetListSkeleton } from "./PetListSkeleton";

// The pet list. The URL holds the filters (FilterBar writes it, debounced), `usePetList` reads the
// committed URL and fetches with SWR, so changing a filter never re-renders the server page:
// a combination that is already cached shows at once (and refreshes in place), and one that is not
// shows a grid of skeleton cards until its rows arrive.
// The server page passes the first page of data so the first paint has no skeleton.
// The pager lives in FilterBar's toolbar and reads the same cached data.
export function PetList(seed: PetListSeed) {
  // No `keepPreviousData` here: with it the old rows would stay up while a new filter loads and the
  // skeleton would never show.
  const { data, error, isValidating } = usePetList(seed);
  const invalidate = useInvalidatePets();

  if (!data) {
    return error ? (
      <EmptyState title="Could not load the pets">
        <p className="mb-3">{error.message}</p>
        <Button variant="outline" onClick={() => invalidate()}>
          Try again
        </Button>
      </EmptyState>
    ) : (
      <PetListSkeleton />
    );
  }

  return (
    <>
      {/* Announced politely when the count changes after a filter. */}
      <p aria-live="polite" className="mb-4 text-sm text-muted-foreground">
        {data.totalDocs} in total{isValidating ? " · Updating…" : ""}
      </p>

      {error ? (
        <p role="alert" className="mb-4 text-sm text-destructive">
          Could not refresh: {error.message}{" "}
          <button className="underline" onClick={() => invalidate()}>
            Try again
          </button>
        </p>
      ) : null}

      {data.docs.length === 0 ? (
        <EmptyState title="No pets found">
          Try different filters, or add a pet.
        </EmptyState>
      ) : (
        <div className={PET_GRID}>
          {data.docs.map((pet) => (
            <PetCard key={pet.id} pet={pet} />
          ))}
        </div>
      )}
    </>
  );
}
