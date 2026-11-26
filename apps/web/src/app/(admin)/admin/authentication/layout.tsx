import { PageHeader } from '@/components/admin/PageHeader'
import { AuthenticationNav } from '@/components/admin/settings/AuthenticationNav'

// The Authentication page: its screens (Two-factor, Archived accounts) in a side menu next to the
// content, like Email and Site settings. Each screen is its own route and checks its own permission.
export default function AuthenticationLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Authentication" />
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <AuthenticationNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </>
  )
}
