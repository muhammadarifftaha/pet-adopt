import { FiClipboard } from 'react-icons/fi'

import { definePlugin } from '@pet-adopt/plugin-sdk'

import { FORM_BUILDER, formBuilderStorage } from './storage'

export { FORM_BUILDER, formBuilderStorage, openFormsDatabase } from './storage'
export * from './fields'

// Form builder. Lets owners build forms (adoption applications, volunteer sign-ups, contact) and
// read what visitors send. A plugin with its own tables (schema/, migrations.ts, src/storage.ts): adding it to
// a running site needs `pnpm migrate` (PostgreSQL) before its screens work; until then they show a
// notice. The field model and its validation are in src/fields.ts.
//
// TODO, in order:
// 1. Repository (src/server.ts): forms CRUD over openFormsDatabase(), responses (paged, mark read,
//    delete, CSV), and the public submit with a honeypot and the throttle in src/server/throttle.ts.
// 2. Actions: list/get/save/delete for signed-in users, and a public submit action.
// 3. Screens below: the list, an editor (add, reorder with buttons, remove fields; React Hook Form
//    + zod reusing validateFormFields) and a responses table (CSV export).
// 4. A Puck block "Form" in src/puck/config.tsx that picks a form and renders it on a page
//    (server-rendered, no hooks in the block; the submit button is a small client component).
// 5. Optional: email new responses (settings.notifyEmail) through getEmailSender().

export const formBuilder = definePlugin<{ title?: string } | void>((options) => ({
  name: FORM_BUILDER,
  title: options?.title ?? 'Forms',
  description: 'Build forms for the site, such as adoption applications or volunteer sign-ups, and read the responses.',
  storage: formBuilderStorage,
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
