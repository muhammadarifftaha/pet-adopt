import { redirect } from 'next/navigation'

// Email moved out of Site settings to its own page; old links still work.
export default function OldEmailSettingsPage() {
  redirect('/admin/email')
}
