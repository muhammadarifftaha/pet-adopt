import { foldText } from '@pet-adopt/plugin-sdk'

import { DEFAULT_REGION } from './phone'

// Suggestions for the pet form's City and State boxes. Pure: the data itself is read on the server
// (src/server/places.ts); this file holds the shapes sent to the browser and the search over them.
// The boxes stay free text: a place missing from the list can simply be typed.

export type PlaceCountry = {
  /** ISO 3166-1 alpha-2, for example "MY". */
  code: string
  name: string
  flag: string
}

/**
 * One country's states and cities, packed small because a large country has thousands of cities:
 * a city is `[name, index into states]`, with -1 for a city that has no state.
 */
export type CountryPlaces = {
  code: string
  states: string[]
  cities: Array<[name: string, state: number]>
}

export type CityChoice = {
  /** Unique within a country: the same city name can appear in several states. */
  key: string
  city: string
  /** Blank for a city that has no state. */
  state: string
}

/**
 * The country the site is in: the one chosen in Site settings, else the country of the default
 * calling code (NEXT_PUBLIC_DEFAULT_COUNTRY_CODE). New pets start with it, and a pet's page names
 * the pet's country only when it is another one.
 */
export function siteCountryCode(settings: { country: string | null }): string {
  return settings.country ?? DEFAULT_REGION
}

/** The most suggestions a box draws at once. People narrow the rest by typing. */
export const PLACE_LIMIT = 50

/**
 * The entries matching what was typed, ignoring case and accents ("malaga" finds "Málaga"): names
 * that start with it first, then names that contain it, each group in the list's own order.
 * Nothing typed returns the start of the list.
 */
export function matchPlaces<T>(items: readonly T[], nameOf: (item: T) => string, query: string, limit = PLACE_LIMIT): T[] {
  const term = foldText(query).trim()
  if (!term) return items.slice(0, limit)
  const starts: T[] = []
  const contains: T[] = []
  for (const item of items) {
    const at = foldText(nameOf(item)).indexOf(term)
    if (at === 0) {
      starts.push(item)
      if (starts.length === limit) return starts
    } else if (at > 0 && contains.length < limit) {
      contains.push(item)
    }
  }
  return [...starts, ...contains].slice(0, limit)
}

/**
 * The cities of a country as choices. With a state typed that the country has, that state's cities
 * come first, so an empty City box starts with them; the others stay reachable by typing.
 */
export function cityChoices(places: CountryPlaces, stateName = ''): CityChoice[] {
  const wanted = foldText(stateName).trim()
  const preferred = wanted ? places.states.findIndex((state) => foldText(state) === wanted) : -1
  const first: CityChoice[] = []
  const rest: CityChoice[] = []
  for (const [city, index] of places.cities) {
    const state = index === -1 ? '' : (places.states[index] ?? '')
    const choice = { key: `${city}|${state}`, city, state }
    if (preferred !== -1 && index === preferred) first.push(choice)
    else rest.push(choice)
  }
  return first.length > 0 ? [...first, ...rest] : rest
}
