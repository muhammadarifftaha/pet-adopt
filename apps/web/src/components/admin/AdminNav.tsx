'use client'

import { can, type Role } from '@pet-adopt/plugin-sdk'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createElement, type ReactNode } from 'react'
import type { IconType } from 'react-icons'
import { FiDroplet, FiFileText, FiGrid, FiHeart, FiHome, FiImage, FiPackage, FiSettings, FiUsers } from 'react-icons/fi'

import {
  SidebarGroup,
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
  '/admin/users': FiUsers,
  '/admin/plugins': FiGrid,
}

// A named nav landmark holding the sidebar's menus. Links keep `aria-current="page"` and a non-colour
// cue (underline) next to the highlight. Nested screens (/admin/pets/3) keep their section current;
// when two entries match (a plugin's home /admin/plugins/x and its /admin/plugins/x/reports) the
// longest href wins. Plugin screens from pet-adopt.config.ts get their own "Plugins" group.
export function AdminNav({
  items,
  pluginItems = [],
  role,
}: {
  items: AdminNavItem[]
  pluginItems?: AdminNavItem[]
  role: Role
}) {
  const pathname = usePathname()
  const allowed = (list: AdminNavItem[]) => list.filter((item) => !item.permission || can(role, item.permission))
  const core = allowed(items)
  const plugins = allowed(pluginItems)

  const matches = (href: string) =>
    href === '/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
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

  return (
    <nav aria-label="Admin">
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>{renderItems(core)}</SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {plugins.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel>Plugins</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(plugins, FiPackage)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
    </nav>
  )
}
