// A pet's age, worked out from its birth date every time it is shown, so it keeps up with the
// calendar without anyone editing it. Dates are plain `YYYY-MM-DD` strings (they sort as dates, on
// SQLite and PostgreSQL alike). Everything takes `today` as a parameter, so tests can move time.
// No imports: the schema files and scripts load this too.

export type AgeUnit = 'weeks' | 'months' | 'years'
export type AgeGroup = 'baby' | 'young' | 'adult' | 'senior'

const DAY_MS = 86_400_000

/** Today as YYYY-MM-DD (UTC). */
export function todayISO(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')
const toISO = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`

function parse(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return { y, m, d }
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** `iso` minus whole months. The day is kept unless that month is shorter (31 March - 1 month = 28 February). */
export function subtractMonths(iso: string, months: number): string {
  const { y, m, d } = parse(iso)
  const index = y * 12 + (m - 1) - months
  const year = Math.floor(index / 12)
  const month = (((index % 12) + 12) % 12) + 1
  return toISO(year, month, Math.min(d, daysInMonth(year, month)))
}

export function subtractDays(iso: string, days: number): string {
  const { y, m, d } = parse(iso)
  return new Date(Date.UTC(y, m - 1, d) - days * DAY_MS).toISOString().slice(0, 10)
}

/** "About 8 months old" as a birth date: the day that many weeks, months or years before `today`. */
export function estimateBirthDate(value: number, unit: AgeUnit, today: string = todayISO()): string {
  if (unit === 'weeks') return subtractDays(today, value * 7)
  return subtractMonths(today, unit === 'years' ? value * 12 : value)
}

function elapsed(birthDate: string, today: string) {
  const b = parse(birthDate)
  const t = parse(today)
  const days = Math.round((Date.UTC(t.y, t.m - 1, t.d) - Date.UTC(b.y, b.m - 1, b.d)) / DAY_MS)
  const months = t.y * 12 + t.m - (b.y * 12 + b.m) - (t.d < b.d ? 1 : 0)
  return { days, months }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * "3 weeks", "8 months", "1 year 4 months", "5 years". An estimated birth date gets "About ".
 * Returns null for a birth date in the future.
 */
export function formatAge(birthDate: string, opts: { estimated?: boolean; today?: string } = {}): string | null {
  const { days, months } = elapsed(birthDate, opts.today ?? todayISO())
  if (days < 0) return null
  if (days < 7) return 'Under 1 week'

  let label: string
  if (days < 56) label = plural(Math.floor(days / 7), 'week')
  else if (months < 12) label = plural(months, 'month')
  else {
    const years = Math.floor(months / 12)
    const rest = months % 12
    label = years < 3 && rest > 0 ? `${plural(years, 'year')} ${plural(rest, 'month')}` : plural(years, 'year')
  }
  return opts.estimated ? `About ${label}` : label
}

// How many months old a pet can be and still be in each group. Older than the last is "senior".
// One table feeds both the label (ageGroupOf) and the catalog filter (ageGroupRange), so they agree.
const GROUP_LIMITS: ReadonlyArray<readonly [AgeGroup, number]> = [
  ['baby', 6],
  ['young', 24],
  ['adult', 96],
]

export function ageGroupOf(birthDate: string, today: string = todayISO()): AgeGroup {
  for (const [group, months] of GROUP_LIMITS) {
    if (birthDate > subtractMonths(today, months)) return group
  }
  return 'senior'
}

/**
 * The birth dates that fall in a group, for a SQL filter: born after `after` and on or before
 * `onOrBefore` (either can be missing). Null for a group that does not exist.
 */
export function ageGroupRange(group: string, today: string = todayISO()): { after?: string; onOrBefore?: string } | null {
  if (group === 'senior') return { onOrBefore: subtractMonths(today, GROUP_LIMITS[GROUP_LIMITS.length - 1][1]) }
  const index = GROUP_LIMITS.findIndex(([name]) => name === group)
  if (index < 0) return null
  return {
    after: subtractMonths(today, GROUP_LIMITS[index][1]),
    onOrBefore: index > 0 ? subtractMonths(today, GROUP_LIMITS[index - 1][1]) : undefined,
  }
}

/** What to show as the age: worked out from the birth date when there is one, else the typed text. */
export function displayAge(
  row: { birthDate: string | null; birthDateEstimated: boolean; ageDescription: string | null },
  today?: string,
): string | null {
  const live = row.birthDate ? formatAge(row.birthDate, { estimated: row.birthDateEstimated, today }) : null
  return live ?? row.ageDescription
}

/** The age group: worked out from the birth date when there is one, else the one that was picked. */
export function displayAgeGroup(row: { birthDate: string | null; ageGroup: string | null }, today?: string): string | null {
  return row.birthDate ? ageGroupOf(row.birthDate, today) : row.ageGroup
}
