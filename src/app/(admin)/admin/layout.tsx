import { redirect } from 'next/navigation'
import React from 'react'

import { AdminShell } from '@/components/admin/AdminShell'
import { getSessionUser } from '@/server/session'

// The frame for every screen under /admin. The root (admin) layout already redirects signed-out
// visitors; this one needs the user for the menu and role-based navigation.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/admin/login')
  return <AdminShell user={user}>{children}</AdminShell>
}
