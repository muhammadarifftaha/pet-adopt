// The admin's screens, in the order they appear in the navigation. Keep labels meaningful on their
// own and the order the same on every page (WCAG 3.2.3). `adminOnly` items are hidden from editors;
// the pages and actions enforce it anyway.
// A nav icon as plain data (the shape of one SVG), so it can travel from the server to the client
// sidebar, which redraws it. Plugins give a react-icons icon or SVG path data; src/plugins/icon.ts
// converts and checks it.
export type NavIconNode = { tag: string; attr: Record<string, string>; child: NavIconNode[] }
export type NavIcon = { attr: Record<string, string>; child: NavIconNode[] }

export type AdminNavItem = {
  href: string
  label: string
  adminOnly?: boolean
  /** Drawn instead of the built-in icon for this href. Only plugin screens set it. */
  icon?: NavIcon
}

export const ADMIN_NAV: AdminNavItem[] = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/pets', label: 'Pets' },
  { href: '/admin/pages', label: 'Pages' },
  { href: '/admin/media', label: 'Media' },
  { href: '/admin/settings', label: 'Settings', adminOnly: true },
  { href: '/admin/users', label: 'Users', adminOnly: true },
  // Account is in the user menu in the header (UserMenu), not here.
]
