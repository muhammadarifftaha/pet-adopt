import { can } from '@pet-adopt/plugin-sdk'
import type { Data } from '@puckeditor/core'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import React from 'react'

import { BuilderContent } from '@/components/site/BuilderContent'
import { ThemePreviewBridge } from '@/components/site/ThemePreviewBridge'
import { getSessionUser } from '@/server/session'

// The theme editor's live preview (signed in only): a sample page built from real blocks, so a
// theme is judged on what visitors will see. The editor layout loads the site's CSS and fonts; the
// bridge applies the theme being edited, sent by the editor page, on top of the active one.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Theme preview', robots: { index: false, follow: false } }

const SAMPLE: Data = {
  root: { props: {} },
  zones: {},
  content: [
    {
      type: 'Hero',
      props: {
        id: 'hero',
        heading: 'Find your new best friend',
        subheading: 'This is how headings, text and buttons look with this theme.',
        image: null,
        ctaLabel: 'Meet the pets',
        ctaHref: '#',
        showWhatsApp: true,
        align: 'center',
        height: 'md',
      },
    },
    {
      type: 'Features',
      props: {
        id: 'features',
        heading: 'Every pet comes',
        intro: '',
        columns: 3,
        items: [
          { icon: 'shield', title: 'Vaccinated', text: 'Up to date before going home.' },
          { icon: 'health', title: 'Vet checked', text: 'Seen by our vet, with notes you can read.' },
          { icon: 'heart', title: 'Lifetime support', text: 'We are a message away after adoption.' },
        ],
        align: 'center',
        background: 'none',
      },
    },
    {
      type: 'PetGrid',
      props: { id: 'pets', heading: 'Ready for adoption', species: '', status: '', featuredOnly: false, limit: 4, showViewAll: true, background: 'tint' },
    },
    {
      type: 'CostTable',
      props: {
        id: 'cost',
        heading: 'What does it cost?',
        headingStyle: 'normal',
        intro: 'Highlighted rows, borders and muted text.',
        image: null,
        imageSide: 'left',
        itemLabel: 'Care',
        valueLabel: 'Average cost',
        rows: [
          { label: 'Vaccinations', value: 'RM 100 – 140', highlight: 'none' },
          { label: 'Total for a healthy rescue', value: 'RM 320 – 450', highlight: 'total' },
          { label: 'Emergency care', value: 'RM 600 +', highlight: 'strong' },
        ],
        note: '',
        background: 'none',
      },
    },
    {
      type: 'CallToAction',
      props: { id: 'cta', heading: 'Ready to meet them?', text: 'A dark band, as used for calls to action.', action: 'link', buttonLabel: 'Get in touch', href: '#', background: 'dark' },
    },
  ],
}

export default async function ThemePreviewPage() {
  const user = await getSessionUser()
  if (!user) redirect('/admin/login?redirect=%2Fadmin%2Ftheme')
  if (!can(user.role, 'theme:view')) redirect('/admin')
  return (
    <main>
      <BuilderContent data={SAMPLE} title="Theme preview" />
      <ThemePreviewBridge />
    </main>
  )
}
