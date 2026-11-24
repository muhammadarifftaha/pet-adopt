import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  type CountryCode,
  type PhoneNumber,
} from 'libphonenumber-js/max'

// Phone numbers through libphonenumber-js, a smaller rewrite of Google's libphonenumber that uses
// Google's metadata. The `/max` build carries the full patterns, so validity matches Google's
// (the default build only checks lengths). The country list, parsing, validation and formatting
// live here. Pure, so the settings form (in the browser) and the server use the same rules.
// Numbers are stored in E.164 ("+60123456789"); wa.me links drop the "+".

/** Calling code used for numbers typed without one (012-345 6789). Malaysia unless overridden. */
const DEFAULT_CALLING_CODE = process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE || '60'

const isRegion = (value: string): value is CountryCode => (getCountries() as string[]).includes(value)

/** The region (ISO 3166 code) for the default calling code, for example "MY". */
export const DEFAULT_REGION: string =
  getCountries().find((region) => getCountryCallingCode(region) === DEFAULT_CALLING_CODE) ?? 'MY'

export type Country = {
  /** ISO 3166-1 alpha-2, for example "MY". */
  region: string
  name: string
  /** Without the "+", for example 60. */
  callingCode: number
  flag: string
}

/** Regional indicator letters, which most systems draw as the country's flag. */
function flagOf(region: string) {
  return String.fromCodePoint(...[...region].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65))
}

let countries: Country[] | null = null

/** Every region the metadata knows, by English name. */
export function listCountries(): Country[] {
  if (countries) return countries
  const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' })
  countries = getCountries()
    .map((region) => ({ region, name: names.of(region) ?? region, callingCode: Number(getCountryCallingCode(region)), flag: flagOf(region) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  return countries
}

export function countryOf(region: string): Country | undefined {
  return listCountries().find((country) => country.region === region)
}

function parse(raw: string, region: string): PhoneNumber | undefined {
  return parsePhoneNumberFromString(raw, isRegion(region) ? region : undefined)
}

/** The number's region; for an invalid number (which may have none), the main region of its calling code. */
function regionOf(number: PhoneNumber, fallback: string): string {
  if (number.country) return number.country
  return getCountries().find((region) => getCountryCallingCode(region) === number.countryCallingCode) ?? fallback
}

/** "12 345 6789": the international format without the "+60 " in front. */
function nationalPart(number: PhoneNumber) {
  const international = number.formatInternational()
  const prefix = `+${number.countryCallingCode}`
  return international.startsWith(prefix) ? international.slice(prefix.length).trim() : number.formatNational()
}

/**
 * Splits a stored or typed number into its region and the national part shown next to the country
 * picker ("+60123456789" -> MY, "12 345 6789"). Anything unparseable stays as typed.
 */
export function splitPhone(raw: string | null | undefined, fallbackRegion = DEFAULT_REGION): { region: string; national: string } {
  const value = raw?.trim() ?? ''
  if (!value) return { region: fallbackRegion, national: '' }
  const number = parse(value, fallbackRegion)
  if (!number) return { region: fallbackRegion, national: value }
  return { region: regionOf(number, fallbackRegion), national: nationalPart(number) }
}

/**
 * Joins the picker's region and the typed national part into one value. A national part pasted
 * with its own "+code" keeps that code. Unparseable input is kept as typed, so validation can
 * point at it instead of it vanishing.
 */
export function joinPhone(region: string, national: string): string {
  const typed = national.trim()
  if (!typed) return ''
  const number = parse(typed, region)
  if (number) return number.number
  if (typed.startsWith('+') || !isRegion(region)) return typed
  return `+${getCountryCallingCode(region)} ${typed}`
}

/** The national part tidied for display, or the input unchanged when it is not a valid number. */
export function formatNational(region: string, national: string): string {
  const number = parse(national, region)
  return number?.isValid() ? nationalPart(number) : national
}

/** True, or why the number cannot be used. Numbers without a "+code" are read as `region`. */
export function validatePhone(raw: string, region = DEFAULT_REGION): true | string {
  const value = raw.trim()
  if (!value) return 'Enter a phone number.'
  if (/[a-z]/i.test(value)) return 'Use digits only (spaces, dashes and brackets are fine).'
  const fallback = isRegion(region) ? region : undefined
  const number = parse(value, region)
  if (!number) {
    return validatePhoneNumberLength(value, fallback) === 'INVALID_COUNTRY'
      ? 'That country code does not exist.'
      : 'Enter a valid phone number, for example +60 12-345 6789.'
  }
  const country = countryOf(regionOf(number, region))
  const label = country ? `${country.name} (+${country.callingCode})` : `+${number.countryCallingCode}`
  const length = validatePhoneNumberLength(value, fallback)
  if (length === 'TOO_SHORT') return `This number is too short for ${label}.`
  if (length === 'TOO_LONG') return `This number is too long for ${label}.`
  if (!number.isValid()) return `This is not a valid number for ${label}.`
  return true
}

/** The number in E.164 ("+60123456789"), or null when it is not valid. */
export function toE164(raw: string, region = DEFAULT_REGION): string | null {
  if (validatePhone(raw, region) !== true) return null
  return parse(raw.trim(), region)?.number ?? null
}
