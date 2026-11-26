import { EmailNav } from '@/components/admin/settings/EmailNav'
import { PageHeader } from '@/components/admin/PageHeader'

// The Email page: its screens (Sending, Templates) in a side menu next to the content, like Site
// settings: a fixed column from md up (it stays in view while the page scrolls), stacked above the
// content on phones. Each screen is its own route and checks its own permission.
export default function EmailLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Email" />
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <EmailNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </>
  )
}
