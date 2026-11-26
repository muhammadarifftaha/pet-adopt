'use client'

import { can, type Role } from '@pet-adopt/plugin-sdk'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createElement, type ReactNode } from 'react'
import type { IconType } from 'react-icons'
import { FiActivity, FiDroplet, FiMail, FiFileText, FiHeart, FiHome, FiImage, FiLock, FiPackage, FiSettings, FiUsers } from 'react-icons/fi'

import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@pet-adopt/ui/components/sidebar'
import { cn } from '@/lib/utils'

import type { AdminNavItem, NavIcon, NavIconNode } from './nav-items'

function drawNodes(nodes: NavIconNode[]): ReactNode {
  return nodes.map((node, index) => createElement(node.tag, { key: index, ...node.attr }, drawNodes(node.child)))
}

// A plugin's icon: SVG data that the server already checked (src/plugins/icon.ts), drawn at text size.
// The colour defaults are the ones react-icons itself applies, which icon packs such as FontAwesome
// rely on (their data has no fill), so every icon follows the text colour and the light/dark theme.
function NavIconSvg({ icon }: { icon: NavIcon }) {
  return (
    <svg
      width="1em"
      height="1em"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="0"
      aria-hidden="true"
      focusable="false"
      {...icon.attr}
    >
      {drawNodes(icon.child)}
    </svg>
  )
}

// Icons are looked up by href here instead of travelling in the nav data: that data is built on the
// server, and a component (a function) cannot be passed to a client component. Plugin screens get
// the package icon.
const ICONS: Record<string, IconType> = {
  '/admin': FiHome,
  '/admin/pets': FiHeart,
  '/admin/pages': FiFileText,
  '/admin/media': FiImage,
  '/admin/theme': FiDroplet,
  '/admin/settings': FiSettings,
  '/admin/email': FiMail,
  '/admin/users': FiUsers,
  '/admin/authentication': FiLock,
  '/admin/activity': FiActivity,
}

// A named nav landmark holding the sidebar's menus. Links keep `aria-current="page"` and a non-colour
// cue (underline) next to the highlight. Nested screens (/admin/pets/3) keep their section current;
// when two entries match (a plugin's home /admin/plugins/x and its /admin/plugins/x/reports) the
// longest href wins. Sections, in order: Content, Plugins (screens from pet-adopt.config.ts, with a
// "View all" link to every plugin on the heading's line), Settings; Dashboard sits above them.
export function AdminNav({
  items,
  pluginItems = [],
  pluginsHref,
  role,
}: {
  items: AdminNavItem[]
  pluginItems?: AdminNavItem[]
  /** The list of every plugin: a "View all" link beside the Plugins heading (for roles that can view plugins). */
  pluginsHref?: string
  role: Role
}) {
  const pathname = usePathname()
  const allowed = (list: AdminNavItem[]) => list.filter((item) => !item.permission || can(role, item.permission))
  const core = allowed(items)
  const plugins = allowed(pluginItems)

  const matches = (href: string) =>
    href === '/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
  const viewAll = pluginsHref && can(role, 'plugins:view') ? pluginsHref : null
  const currentHref = [...core, ...plugins]
    .map((item) => item.href)
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0]

  const renderItems = (list: AdminNavItem[], fallback?: IconType) =>
    list.map(({ href, label, icon }) => {
      const Icon = ICONS[href] ?? fallback
      const current = href === currentHref
      return (
        <SidebarMenuItem key={href}>
          <SidebarMenuButton
            isActive={current}
            className={cn(current && 'underline underline-offset-4')}
            render={<Link href={href} aria-current={current ? 'page' : undefined} />}
          >
            {icon ? <NavIconSvg icon={icon} /> : Icon ? <Icon aria-hidden="true" /> : null}
            <span>{label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )
    })

  // Dashboard on its own, then the sections in a fixed order: Content, Plugins, Settings. A section
  // the person's role has nothing in is left out (its heading too).
  const top = core.filter((item) => !item.section)
  const sections: Array<{ label: string; items: AdminNavItem[]; fallback?: IconType; action?: { href: string; label: string; description: string } }> = [
    { label: 'Content', items: core.filter((item) => item.section === 'content') },
    { label: 'Plugins', items: plugins, fallback: FiPackage, action: viewAll ? { href: viewAll, label: 'View all', description: 'View all plugins' } : undefined },
    { label: 'Settings', items: core.filter((item) => item.section === 'settings') },
  ]

  return (
    <nav aria-label="Admin">
      {top.length ? (
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(top)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
      {sections.map(({ label, items: list, fallback, action }) =>
        list.length || action ? (
          <SidebarGroup key={label}>
            <SidebarGroupLabel>{label}</SidebarGroupLabel>
            {action ? (
              // A text link on the heading's line (shadcn's group action is drawn for an icon).
              <SidebarGroupAction
                className={cn(
                  'top-3 aspect-auto w-auto px-1.5 py-0.5 text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground',
                  pathname === action.href && 'text-sidebar-foreground underline underline-offset-4',
                )}
                render={<Link href={action.href} aria-current={pathname === action.href ? 'page' : undefined} aria-label={action.description} />}
              >
                {action.label}
              </SidebarGroupAction>
            ) : null}
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(list, fallback)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null,
      )}
    </nav>
  )
}
