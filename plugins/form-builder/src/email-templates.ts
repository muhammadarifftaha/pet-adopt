import type { PluginEmailTemplate } from '@pet-adopt/plugin-sdk'

// The form builder's default email templates, seeded into Email > Templates at start (as
// `form-builder:notification` and `form-builder:confirmation`). People can edit and restore them,
// not delete them, and a form that picks no other template uses them, so a form's emails always
// have a template. The layouts use the site's template blocks (Heading, Text, Details); {{title}} is
// the form's name.

export const NOTIFICATION_KEY = 'notification'
export const CONFIRMATION_KEY = 'confirmation'
/** The full keys (`<plugin>:<key>`); the plugin's name is fixed (FORM_BUILDER in ./names). */
export const NOTIFICATION_SEED = `form-builder:${NOTIFICATION_KEY}`
export const CONFIRMATION_SEED = `form-builder:${CONFIRMATION_KEY}`

const FOOTER = 'Sent by {{siteName}} · {{siteUrl}}'

export const FORM_EMAIL_TEMPLATES: PluginEmailTemplate[] = [
  {
    key: NOTIFICATION_KEY,
    name: 'Form response',
    purpose: 'team-notification',
    data: {
      root: { props: { subject: 'New response: {{title}}', preheader: 'Someone filled in {{title}}.', showLogo: true, footer: FOOTER } },
      content: [
        { type: 'Heading', props: { id: 'heading-1', text: 'New response to “{{title}}”', level: 'h1', align: 'left' } },
        { type: 'Text', props: { id: 'text-1', text: 'Someone filled in the form on {{siteName}}. Their answers:', align: 'left', size: 'normal' } },
        { type: 'Details', props: { id: 'details-1', title: '' } },
      ],
    },
  },
  {
    key: CONFIRMATION_KEY,
    name: 'Form confirmation',
    purpose: 'visitor-message',
    data: {
      root: { props: { subject: 'Thanks, we got your form', preheader: 'We received your “{{title}}” form.', showLogo: true, footer: FOOTER } },
      content: [
        { type: 'Heading', props: { id: 'heading-1', text: 'Thank you', level: 'h1', align: 'left' } },
        { type: 'Text', props: { id: 'text-1', text: 'We received your “{{title}}” form and will get back to you soon.\n\n{{siteName}}', align: 'left', size: 'normal' } },
      ],
    },
  },
]
