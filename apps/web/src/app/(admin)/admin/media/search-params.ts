import { createLoader, parseAsInteger, parseAsNumberLiteral, parseAsString } from 'nuqs/server'

import { MEDIA_PAGE_SIZES } from '@/lib/admin/media-page'

// The media library's view, as it appears in the URL (?search=&page=&perPage=). Like the pets
// list (../pets/search-params.ts): `nuqs/server` has no React in it, so the server page loads the
// first render with `loadMediaSearchParams` and the client reads and writes the same parsers with
// `useQueryStates(mediaSearchParsers)`. Only the offered page sizes are accepted; anything else
// in the URL falls back to the default.
export const mediaSearchParsers = {
  search: parseAsString.withDefault(''),
  page: parseAsInteger.withDefault(1),
  perPage: parseAsNumberLiteral(MEDIA_PAGE_SIZES.options).withDefault(MEDIA_PAGE_SIZES.default),
}

export const loadMediaSearchParams = createLoader(mediaSearchParsers)
