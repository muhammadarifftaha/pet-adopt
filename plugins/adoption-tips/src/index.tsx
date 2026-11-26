import { FiBookOpen } from 'react-icons/fi'

import { definePlugin } from '@pet-adopt/plugin-sdk'

// A reference plugin (see README.md), listed in apps/web/pet-adopt.config.ts as `adoptionTips()`;
// remove it there to switch it off. A Tips entry appears in the admin menu, its page lives at
// /admin/plugins/adoption-tips, and a card shows on the dashboard.
//
// Screens and widgets are server components by default: they can be async, call the data layer in
// `src/server`, and render shadcn components. For interactivity, render a `'use client'` component.
export const adoptionTips = definePlugin<{ heading?: string } | void>((options) => {
  const heading = options?.heading ?? 'Adoption tips'

  return {
    name: 'adoption-tips',
    title: 'Adoption tips',
    description: 'An example plugin: a Tips screen in the admin and a tip card on the dashboard.',
    screens: [
      {
        path: '',
        title: heading,
        // The menu entry. `Icon` is a react-icons icon (as here) or SVG path data:
        // Icon: { viewBox: '0 0 24 24', paths: ['M12 2 2 22h20z'], outline: true }
        nav: { label: 'Tips', Icon: FiBookOpen },
        component: ({ user }) => (
          <p className="text-sm">
            Hello {user.name}. Put anything here: a report, an import tool, a link to another service.
          </p>
        ),
      },
      {
        // `:id` is a parameter: /admin/plugins/adoption-tips/tips/3 arrives as params.id === '3'.
        path: 'tips/:id',
        title: 'Tip',
        component: ({ params }) => <p className="text-sm">Tip number {params.id}.</p>,
      },
    ],
    dashboardWidgets: [
      {
        id: 'tip-of-the-day',
        title: heading,
        component: () => <p className="text-sm">Photos taken in daylight get more enquiries.</p>,
      },
    ],
  }
})
