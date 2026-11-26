import type { Permission } from '@pet-adopt/plugin-sdk'

// The admin's screens, in the order they appear in the navigation. Keep labels meaningful on their
// own and the order the same on every page (WCAG 3.2.3). An item with a `permission` is hidden from
// roles without it (`can` in the plugin SDK); the pages and actions enforce it anyway.
// A nav icon as plain data (the shape of one SVG), so it can travel from the server to the client
// sidebar, which redraws it. Plugins give a react-icons icon or SVG path data; src/plugins/icon.ts
// converts and checks it.
export type NavIconNode = { tag: string; attr: Record<string, string>; child: NavIconNode[] }
export type NavIcon = { attr: Record<string, string>; child: NavIconNode[] }

/**
 * The sidebar's sections, in this order: Content, then the plugins' screens (their own group, drawn
 * by AdminNav), then Settings. An item without a section (Dashboard) sits above them.
 */
export type AdminNavSection = 'content' | 'settings'

export type AdminNavItem = {
  href: string
  label: string
  /** Which section it is listed in; none: above the sections. Plugin screens are always in Plugins. */
  section?: AdminNavSection
  /** Shown only to roles that have it. */
  permission?: Permission
  /** Drawn instead of the built-in icon for this href. Only plugin screens set it. */
  icon?: NavIcon
}

export const ADMIN_NAV: AdminNavItem[] = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/pets', label: 'Pets', permission: 'pets:view', section: 'content' },
  { href: '/admin/pages', label: 'Pages', permission: 'pages:view', section: 'content' },
  { href: '/admin/media', label: 'Media', permission: 'media:view', section: 'content' },
  // Settings, in the order agreed with the owner: Email, Theme, Users, Authentication, Activity,
  // Site settings.
  // Email: sending (SMTP) and the email templates.
  { href: '/admin/email', label: 'Email', permission: 'settings:view', section: 'settings' },
  { href: '/admin/theme', label: 'Theme', permission: 'theme:view', section: 'settings' },
  { href: '/admin/users', label: 'Users', permission: 'users:view', section: 'settings' },
  // Sign-in rules: which roles must use two-factor, and the archived accounts.
  { href: '/admin/authentication', label: 'Authentication', permission: 'users:view', section: 'settings' },
  // Everyone sees their own entries; admins and audit see everyone's.
  { href: '/admin/activity', label: 'Activity', permission: 'activity:own', section: 'settings' },
  // "Site settings", not "Settings": it sits under the Settings heading.
  { href: '/admin/settings', label: 'Site settings', permission: 'settings:view', section: 'settings' },
  // Account is in the user menu in the header (UserMenu), not here.
]
