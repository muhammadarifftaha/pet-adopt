import { Badge } from '@pet-adopt/ui/components/badge'
import Link from 'next/link'

import { listForms } from '../server'
import { BASE, responsesHref } from './paths'

const SHOWN = 5

// The dashboard card: every form's responses at a glance. Forms with new responses come first, then
// the ones answered most recently. The dashboard leaves the card out while the plugin's tables are
// not set up (see PluginWidgets).
export async function FormsWidget() {
  const forms = await listForms()
  if (forms.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No forms yet.{' '}
        <Link href={BASE} className="underline underline-offset-4">
          Make the first one
        </Link>
        .
      </p>
    )
  }

  const total = forms.reduce((sum, form) => sum + form.responses, 0)
  const unread = forms.reduce((sum, form) => sum + form.unread, 0)
  const sorted = [...forms].sort(
    (a, b) => b.unread - a.unread || (b.lastResponseAt?.getTime() ?? 0) - (a.lastResponseAt?.getTime() ?? 0) || a.name.localeCompare(b.name),
  )

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        {total} {total === 1 ? 'response' : 'responses'} to {forms.length} {forms.length === 1 ? 'form' : 'forms'}
        {unread > 0 ? `, ${unread} new` : ''}.
      </p>
      <ul className="flex flex-col divide-y">
        {sorted.slice(0, SHOWN).map((form) => (
          <li key={form.id} className="flex items-center justify-between gap-3 py-2">
            <Link href={responsesHref(form.id)} className="min-w-0 truncate font-medium underline-offset-4 hover:underline">
              {form.name}
            </Link>
            <span className="flex shrink-0 items-center gap-2">
              {form.unread > 0 && <Badge>{form.unread} new</Badge>}
              <span className="text-muted-foreground">
                {form.responses} {form.responses === 1 ? 'response' : 'responses'}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <Link href={BASE} className="self-start underline underline-offset-4">
        {forms.length > SHOWN ? `All ${forms.length} forms` : 'All forms'}
      </Link>
    </div>
  )
}
