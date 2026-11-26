'use client'

import Link from 'next/link'
import { FiExternalLink } from 'react-icons/fi'

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@pet-adopt/ui/components/sidebar'

// The sidebar footer's link to the public site, in a new tab (the admin stays open), which its icon
// shows and screen readers are told. A client component only because the icon library builds its
// icons on a React context, which server components cannot render.
export function ViewSiteLink() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton render={<Link href="/" target="_blank" rel="noopener noreferrer" />}>
          <FiExternalLink aria-hidden="true" />
          <span>
            View site<span className="sr-only"> (opens in a new tab)</span>
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
