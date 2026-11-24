import { FiClipboard } from 'react-icons/fi'

import { definePlugin } from './define'

// Form builder (scaffold). Lets owners build forms (adoption applications, volunteer sign-ups,
// contact) and read what visitors send. Only the admin screens exist so far.
//
// TODO, in order:
// 1. Storage: tables `forms` (id, name, slug, fields JSON, created/updated) and `form_responses`
//    (id, form_id ON DELETE CASCADE, answers JSON, created_at) in BOTH schema files, then
//    `pnpm db:generate`, `pnpm check:schemas`, and a repository in src/server/forms.ts that
//    validates the fields JSON (types: text, long text, email, phone via src/lib/phone.ts,
//    choice, checkbox; label, required, options) like `isPuckData` does for layouts.
// 2. Actions (src/server/actions/forms.ts): list/get/save/delete for signed-in users, and a public
//    submit action with the throttle in src/server/throttle.ts (per client address) and a honeypot.
// 3. Screens below: the list, an editor (add, reorder with buttons, remove fields; React Hook Form
//    + zod like the settings form) and a responses table (TanStack Table, CSV export).
// 4. A Puck block "Form" in src/puck/config.tsx that picks a form and renders it on a page
//    (server-rendered, no hooks in the block; the submit button is a small client component).
// 5. Optional: email new responses through getEmailSender() when the email plugin is ready.

export const formBuilder = definePlugin<{ title?: string } | void>((options) => ({
  name: 'form-builder',
  title: options?.title ?? 'Forms',
  description: 'Build forms for the site, such as adoption applications or volunteer sign-ups, and read the responses.',
  screens: [
    {
      path: '',
      title: options?.title ?? 'Forms',
      nav: { label: 'Forms', Icon: FiClipboard },
      // TODO: list forms (name, responses count, last response) with "New form".
      component: () => <p className="text-sm text-muted-foreground">No forms yet. The form builder is being set up.</p>,
    },
    {
      path: 'forms/:id',
      title: 'Edit form',
      // TODO: the field editor for form `params.id`.
      component: ({ params }) => <p className="text-sm">Editor for form {params.id} goes here.</p>,
    },
    {
      path: 'forms/:id/responses',
      title: 'Responses',
      // TODO: responses table and CSV export.
      component: ({ params }) => <p className="text-sm">Responses to form {params.id} go here.</p>,
    },
  ],
}))
