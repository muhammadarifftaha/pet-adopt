import { FiClipboard } from 'react-icons/fi'

import { definePlugin } from '@pet-adopt/plugin-sdk'

import { EditForm } from './screens/EditForm'
import { FormsList } from './screens/FormsList'
import { FormsWidget } from './screens/FormsWidget'
import { Responses } from './screens/Responses'
import { FORM_EMAIL_TEMPLATES } from './email-templates'
import { emailTemplateUsage } from './server'
import { FORM_BUILDER, formBuilderStorage } from './storage'

export { FORM_BUILDER, formBuilderStorage, openFormsDatabase } from './storage'
export * from './fields'

// Form builder. Lets owners build forms (adoption applications, volunteer sign-ups, contact) and
// read what visitors send. A plugin with its own tables (schema/, migrations.ts, src/storage.ts): adding it to
// a running site needs `pnpm migrate` (PostgreSQL) before its screens work; until then they show a
// notice. The field model and its validation are in src/fields.ts.
//
// Storage: src/storage.ts. Rules: src/server.ts (forms, responses, CSV, public submit with a honeypot
// and per-visitor and per-form limits). Server actions: src/actions.ts. Field model: src/fields.ts.
// Admin screens: src/screens (built on @pet-adopt/ui). On the site, forms are shown by the page
// builder's Form block (apps/web/src/puck/config.tsx, drawn by apps/web/src/components/site/PublicForm.tsx).

export const formBuilder = definePlugin<{ title?: string } | void>((options) => ({
  name: FORM_BUILDER,
  title: options?.title ?? 'Forms',
  description: 'Build forms for the site, such as adoption applications or volunteer sign-ups, and read the responses.',
  storage: formBuilderStorage,
  // Its default email templates (seeded at start; forms that pick no other use them), and which forms
  // use which template (the "Used by" column of Settings > Email templates).
  emailTemplates: FORM_EMAIL_TEMPLATES,
  emailTemplateUsage,
  screens: [
    {
      path: '',
      title: options?.title ?? 'Forms',
      nav: { label: options?.title ?? 'Forms', Icon: FiClipboard },
      component: ({ user }) => <FormsList user={user} />,
    },
    {
      path: 'forms/:id',
      title: 'Edit form',
      component: ({ params, user }) => <EditForm id={params.id} user={user} />,
    },
    {
      path: 'forms/:id/responses',
      title: 'Responses',
      // What visitors sent: admins and editors; audit can view; developers cannot open it.
      access: 'personalData',
      component: ({ params, searchParams, user }) => <Responses id={params.id} page={searchParams.page} user={user} />,
    },
  ],
  dashboardWidgets: [
    {
      id: 'responses',
      title: options?.title ?? 'Forms',
      component: ({ user }) => <FormsWidget user={user} />,
    },
  ],
}))
