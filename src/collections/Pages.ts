import type { CollectionConfig } from 'payload'

import { isOwner } from '../lib/access'
import { RESERVED_SLUGS } from '../lib/options'
import { isPuckData, stripTransient } from '../puck/data'
import { safeRevalidate } from '../lib/revalidate'
import { SLUG_PATTERN } from '../lib/slugify'

// Pages are laid out with the Puck editor at /edit/[id]. The layout JSON lives in `puckData`.
// "home" is the homepage. The catalog (/pets) and pet pages are fixed routes.
export const Pages: CollectionConfig = {
  slug: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', '_status', 'updatedAt'],
  },
  versions: {
    maxPerDoc: 25,
    // Validate drafts too, so a bad or reserved slug fails on "Save draft", not only on publish.
    drafts: { autosave: false, validate: true },
  },
  access: {
    // Visitors only ever see published pages. Signed-in owners can read drafts too.
    read: ({ req }) => (req.user ? true : { _status: { equals: 'published' } }),
    create: isOwner,
    update: isOwner,
    delete: isOwner,
  },
  hooks: {
    beforeChange: [
      ({ data }) => {
        // Render-only props (such as PetGrid's `pets`) must never be saved, whatever the save path.
        if (isPuckData(data.puckData)) data.puckData = stripTransient(data.puckData)
        return data
      },
    ],
    afterChange: [
      ({ doc, previousDoc }) => {
        const toPath = (slug?: string) => (slug === 'home' ? '/' : `/${slug}`)
        const paths = [toPath(doc.slug)]
        if (previousDoc?.slug && previousDoc.slug !== doc.slug) paths.push(toPath(previousDoc.slug))
        safeRevalidate(paths)
        return doc
      },
    ],
    afterDelete: [
      ({ doc }) => {
        safeRevalidate([doc.slug === 'home' ? '/' : `/${doc.slug}`])
        return doc
      },
    ],
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true, // a unique constraint is already an index
      admin: {
        position: 'sidebar',
        description: 'Lowercase letters, numbers and dashes. Use "home" for the homepage.',
      },
      validate: (value: string | null | undefined) => {
        if (!value) return 'A slug is required.'
        if (!SLUG_PATTERN.test(value)) return 'Use lowercase letters, numbers and single dashes only.'
        if (RESERVED_SLUGS.includes(value)) return `"${value}" is used by the site itself. Pick another slug.`
        return true
      },
    },
    {
      name: 'builder',
      type: 'ui',
      admin: {
        components: {
          Field: '/components/admin/OpenBuilder#OpenBuilder',
        },
      },
    },
    {
      // Puck's layout JSON. Edited through the page builder, so hidden from this form.
      name: 'puckData',
      type: 'json',
      admin: { hidden: true },
      validate: (value: unknown) => value == null || isPuckData(value) || 'Invalid page layout data.',
    },
    {
      name: 'seo',
      type: 'group',
      label: 'SEO',
      fields: [
        { name: 'description', type: 'textarea', maxLength: 200 },
        { name: 'image', type: 'upload', relationTo: 'media', label: 'Share image' },
      ],
    },
  ],
}
