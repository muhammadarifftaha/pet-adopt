import { createLoader, parseAsInteger, parseAsString, parseAsStringEnum } from "nuqs/server";

import { PET_STATUS_VALUES } from "@/lib/options";

// The pet list's filters, as they appear in the URL (?search=&status=&species=&page=).
// `nuqs/server` has no React in it, so this file is safe to import from the server page (through
// `loadPetSearchParams`) and from a client filter bar (`useQueryStates(petSearchParsers)`).
// A filter that is not in the URL is `null`, which means "any": there is no "All" value to map back.
export const petSearchParsers = {
  search: parseAsString.withDefault(""),
  status: parseAsStringEnum(PET_STATUS_VALUES),
  species: parseAsString,
  page: parseAsInteger.withDefault(1),
};

export const loadPetSearchParams = createLoader(petSearchParsers);
