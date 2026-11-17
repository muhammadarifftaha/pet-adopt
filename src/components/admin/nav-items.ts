// The admin's screens, in the order they appear in the navigation. Keep labels meaningful on their
// own and the order the same on every page (WCAG 3.2.3). `adminOnly` items are hidden from editors;
// the pages and actions enforce it anyway.
export type AdminNavItem = {
  href: string
  label: string
  adminOnly?: boolean
}

export const ADMIN_NAV: AdminNavItem[] = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/pets', label: 'Pets' },
  { href: '/admin/pages', label: 'Pages' },
  { href: '/admin/media', label: 'Media' },
  { href: '/admin/settings', label: 'Settings', adminOnly: true },
  { href: '/admin/users', label: 'Users', adminOnly: true },
  { href: '/admin/account', label: 'Account' },
]
