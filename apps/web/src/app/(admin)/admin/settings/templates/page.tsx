import { redirect } from 'next/navigation'

// Email templates moved to the Email page; old links still work.
export default function OldEmailTemplatesPage() {
  redirect('/admin/email/templates')
}
