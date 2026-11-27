import { getAllCitiesOfCountry, getCountries, getCountryTimezones, getStatesOfCountry } from '@countrystatecity/countries'
import { foldText } from '@pet-adopt/plugin-sdk'

import type { CountryPlaces, PlaceCountry } from '@/lib/places'

// Countries, states and cities for the pet form's suggestions, read from the files inside the
// `@countrystatecity/countries` package (the Countries States Cities Database, ODbL 1.0; see the
// README's credits). Nothing leaves the server: no outside service is asked. The package's ids
// change between its releases, so only names are used and stored.

/** `pets.city` and `pets.state` hold at most this many characters; longer names are left out. */
const MAX_NAME = 60

const byName = (a: string, b: string) => foldText(a).localeCompare(foldText(b)) || a.localeCompare(b)

const clean = (name: string) => name.replace(/\s+/g, ' ').trim()

/** Regional indicator letters, which most systems draw as the country's flag. */
function flagOf(code: string) {
  return String.fromCodePoint(...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65))
}

let countries: Promise<PlaceCountry[]> | null = null

/** Every country in the data, by name. */
export function listPlaceCountries(): Promise<PlaceCountry[]> {
  countries ??= getCountries()
    .then((list) =>
      list
        .filter((country) => /^[A-Z]{2}$/.test(country.iso2))
        .map((country) => ({ code: country.iso2, name: clean(country.name), flag: flagOf(country.iso2) }))
        .sort((a, b) => byName(a.name, b.name)),
    )
    .catch((error) => {
      // Do not remember a failure: the next call reads again.
      countries = null
      throw error
    })
  return countries
}

/** The country with this code (any case), or null when the data has none. */
export async function findPlaceCountry(code: string | null | undefined): Promise<PlaceCountry | null> {
  if (typeof code !== 'string' || !/^[A-Za-z]{2}$/.test(code)) return null
  const wanted = code.toUpperCase()
  return (await listPlaceCountries()).find((country) => country.code === wanted) ?? null
}

/**
 * A pet's location as its own page shows it. A location made from the city and state gets the
 * country's name added when the pet is in another country than the site ("Málaga, Spain"); one in
 * the site's country, and a location someone typed themselves, is shown as it is.
 */
export async function displayLocation(
  pet: { location: string | null; city: string | null; state: string | null; country: string | null },
  siteCountry: string,
): Promise<string | null> {
  if (!pet.location || !(pet.city || pet.state) || !pet.country || pet.country === siteCountry) return pet.location
  const name = (await findPlaceCountry(pet.country))?.name
  return name ? `${pet.location}, ${name}` : pet.location
}

/** The IANA time zones a country uses ("Asia/Kuala_Lumpur"); none for an unknown country. */
export async function listCountryTimeZones(countryCode: string): Promise<string[]> {
  const country = await findPlaceCountry(countryCode)
  if (!country) return []
  return [...new Set((await getCountryTimezones(country.code)).filter((name) => typeof name === 'string' && name))]
}

// A country's packed list is built once and kept: the data only changes with the package.
const places = new Map<string, Promise<CountryPlaces>>()

async function readPlaces(code: string): Promise<CountryPlaces> {
  const [stateRows, cityRows] = await Promise.all([getStatesOfCountry(code), getAllCitiesOfCountry(code)])

  const states = [...new Set(stateRows.map((state) => clean(state.name)).filter((name) => name && name.length <= MAX_NAME))].sort(byName)
  const indexOfState = new Map(states.map((name, index) => [name, index]))
  const nameOfState = new Map(stateRows.map((state) => [state.iso2, clean(state.name)]))

  const seen = new Set<string>()
  const cities: CountryPlaces['cities'] = []
  for (const row of cityRows) {
    const name = clean(row.name)
    if (!name || name.length > MAX_NAME) continue
    const state = indexOfState.get(nameOfState.get(row.state_code ?? '') ?? '') ?? -1
    const key = `${name}|${state}`
    if (seen.has(key)) continue
    seen.add(key)
    cities.push([name, state])
  }
  cities.sort((a, b) => byName(a[0], b[0]) || a[1] - b[1])

  return { code, states, cities }
}

/**
 * The states and cities of one country. An unknown code gives empty lists, so the form simply has
 * nothing to suggest.
 */
export async function listPlaces(countryCode: string): Promise<CountryPlaces> {
  const code = (await findPlaceCountry(countryCode.trim()))?.code
  if (!code) return { code: countryCode.trim().toUpperCase(), states: [], cities: [] }

  let found = places.get(code)
  if (!found) {
    found = readPlaces(code).catch((error) => {
      places.delete(code)
      throw error
    })
    places.set(code, found)
  }
  return found
}
