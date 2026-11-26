import { redirect } from 'next/navigation'
import React from 'react'

import { AdminShell } from '@/components/admin/AdminShell'
import { EmailConfirmBanner } from '@/components/admin/EmailConfirmBanner'
import { needsEmailConfirmation } from '@/server/email-change'
import { getSessionUser } from '@/server/session'

// The frame for every screen under /admin. The root (admin) layout already redirects signed-out
// visitors; this one needs the user for the menu and role-based navigation.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/admin/login')
  // Not confirmed their email while the site can send email: a banner, and changes are refused.
  const banner = (await needsEmailConfirmation(user)) ? <EmailConfirmBanner email={user.email} /> : null
  return (
    <AdminShell user={user} banner={banner}>
      {children}
    </AdminShell>
  )
}
