import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/PageHeader";
import { buttonVariants } from "@pet-adopt/ui/components/button";
import { requirePermissionPage, unwrap } from "@/lib/admin/unwrap";
import { can } from "@pet-adopt/plugin-sdk";
import {
  listPetsAction,
  listSpeciesOptionsAction,
} from "@/server/actions/pets";
import type { SearchParams } from "nuqs/server";
import { FiPlus } from "react-icons/fi";
import { loadPetSearchParams } from "./search-params";
import { FilterBar } from "@/components/admin/pets/FilterBar";
import { PetList } from "@/components/admin/pets/PetList";
import { ViewOnly } from "@/components/admin/view-only";

export const metadata: Metadata = { title: "Pets" };

// The filters live in the URL (?search=&status=&species=&page=), so the list can be linked to and
// the back button works. This server component only loads the first render: the URL as it was when
// the page was opened (see ./search-params.ts) and the data for it. After that FilterBar changes the
// URL without asking the server, and PetList fetches and caches the rows with SWR.
export default async function PetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requirePermissionPage("pets:view");
  const canEdit = can(user.role, "pets:edit");
  const filters = await loadPetSearchParams(searchParams);
  const [speciesOptions, initialData] = await Promise.all([
    listSpeciesOptionsAction().then(unwrap),
    listPetsAction({
      search: filters.search,
      status: filters.status ?? undefined,
      species: filters.species ?? undefined,
      page: filters.page,
    }).then(unwrap),
  ]);

  return (
    <>
      <PageHeader
        title="Pets"
        actions={
          canEdit ? (
            <Link href="/admin/pets/new" className={buttonVariants()}>
              <FiPlus className="h-4 w-4" />
              Add pet
            </Link>
          ) : null
        }
      />

      <FilterBar
        speciesOptions={speciesOptions}
        initialFilters={filters}
        initialData={initialData}
      />

      <ViewOnly value={!canEdit}>
        <PetList initialFilters={filters} initialData={initialData} />
      </ViewOnly>
    </>
  );
}
