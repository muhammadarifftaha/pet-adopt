'use server'

import type { CountryPlaces, PlaceCountry } from '@/lib/places'

import { listCountryTimeZones, listPlaceCountries, listPlaces } from '../places'
import { run, UserError, type ActionResult } from '../result'
import { requirePermission } from '../session'

/** The countries the pet form can suggest cities and states for. */
export async function listPlaceCountriesAction(): Promise<ActionResult<PlaceCountry[]>> {
  return run(async () => {
    await requirePermission('pets:view')
    return listPlaceCountries()
  })
}

/** One country's states and cities (ISO 3166-1 alpha-2 code), as suggestions for the pet form. */
export async function listPlacesAction(countryCode: string): Promise<ActionResult<CountryPlaces>> {
  return run(async () => {
    await requirePermission('pets:view')
    if (typeof countryCode !== 'string' || !/^[A-Za-z]{2}$/.test(countryCode)) throw new UserError('Pick a country from the list.')
    return listPlaces(countryCode)
  })
}

/**
 * The time zones a country uses, for Site settings > Region. Needs no more than the pet form's
 * lists do: it is the same public reference data.
 */
export async function listCountryTimeZonesAction(countryCode: string): Promise<ActionResult<string[]>> {
  return run(async () => {
    await requirePermission('pets:view')
    if (typeof countryCode !== 'string' || !/^[A-Za-z]{2}$/.test(countryCode)) throw new UserError('Pick a country from the list.')
    return listCountryTimeZones(countryCode)
  })
}
