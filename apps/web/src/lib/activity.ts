// Pure parts of the activity log, shared by the server (src/server/activity.ts) and the screen.

/** What an entry is about, for the filter. Plugins' entries are all `plugins`. */
export const ACTIVITY_AREAS = ['pets', 'pages', 'media', 'theme', 'settings', 'users', 'account', 'sign-in', 'plugins', 'activity'] as const
export type ActivityArea = (typeof ACTIVITY_AREAS)[number]

export const ACTIVITY_AREA_LABELS: Record<ActivityArea, string> = {
  pets: 'Pets',
  pages: 'Pages',
  media: 'Media',
  theme: 'Theme',
  settings: 'Settings',
  users: 'Users',
  account: 'Own account',
  'sign-in': 'Sign-in and sign-out',
  plugins: 'Plugins',
  activity: 'Activity log',
}

export const isActivityArea = (value: unknown): value is ActivityArea => (ACTIVITY_AREAS as readonly unknown[]).includes(value)

/** A stored field name for people: `birthDate` -> "birth date", `seo.image` -> "seo image". */
export function fieldLabel(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._]+/g, ' ')
    .toLowerCase()
    .trim()
}
