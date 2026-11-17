import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { signOutAction } from '@/server/actions/auth'
import type { SessionUser } from '@/server/types'
import { redirect } from 'next/navigation'

// Shows who is signed in and a Sign out button. A form with a server action, so it works without
// client JavaScript. TODO(ui): turn into a dropdown menu if you prefer.
export function UserMenu({ user }: { user: SessionUser }) {
  async function signOut() {
    'use server'
    await signOutAction()
    redirect('/admin/login')
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm">{user.name}</span>
      <Badge variant="secondary">{user.role}</Badge>
      <form action={signOut}>
        <Button type="submit" variant="outline" size="sm">
          Sign out
        </Button>
      </form>
    </div>
  )
}
