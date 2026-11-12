import type { CollectionConfig } from 'payload'

import { isOwner } from '../lib/access'
import { validateWebUrl } from '../lib/links'
import { AGE_GROUPS, GOOD_WITH, SEXES, SIZES, SPECIES, STATUSES, TEMPERAMENTS } from '../lib/options'
import { safeRevalidate } from '../lib/revalidate'
import { SLUG_PATTERN, slugify } from '../lib/slugify'
import { normalizePhone } from '../lib/whatsapp'

export const Pets: CollectionConfig = {
  slug: 'pets',
  labels: { singular: 'Pet', plural: 'Pets' },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'species', 'status', 'featured', 'location', 'updatedAt'],
    listSearchableFields: ['name', 'breed', 'location'],
  },
  access: {
    // Visitors never get unlisted pets from the API. Owners see everything. (The public pet page
    // opens unlisted pets by direct link through the Local API, which does not use this rule.)
    read: ({ req }) => (req.user ? true : { unlisted: { not_equals: true } }),
    create: isOwner,
    update: isOwner,
    delete: isOwner,
  },
  defaultSort: '-createdAt',
  // The catalog filters on status (usually "available") and sorts newest first.
  indexes: [{ fields: ['status', 'createdAt'] }],
  hooks: {
    beforeValidate: [
      async ({ data, originalDoc, req }) => {
        if (!data) return data
        // Slug: derive it from the name when there is none. A partial update that only
        // sends other fields keeps the stored slug, so public URLs never change by accident.
        const name = data.name ?? originalDoc?.name
        if (!(data.slug ?? originalDoc?.slug) && name) {
          // Names without Latin letters (Chinese, Tamil, Arabic...) slugify to nothing.
          const base = slugify(name) || `pet-${Date.now().toString(36)}`
          let candidate = base
          for (let i = 2; i <= 50; i++) {
            const existing = await req.payload.find({
              collection: 'pets',
              where: { slug: { equals: candidate } },
              limit: 1,
              depth: 0,
              req,
            })
            if (!existing.docs.some((d) => d.id !== originalDoc?.id)) {
              data.slug = candidate
              return data
            }
            candidate = `${base}-${i}`
          }
          // Every numbered variant is taken: fall back to a unique suffix.
          data.slug = `${base}-${Date.now().toString(36)}`
        }
        return data
      },
    ],
    beforeChange: [
      async ({ data, operation, originalDoc }) => {
        // Stamp the adoption date when a pet is marked adopted.
        const status = data.status ?? originalDoc?.status
        if (status === 'adopted') {
          data.adoptedAt = data.adoptedAt ?? originalDoc?.adoptedAt ?? new Date().toISOString()
        } else if (operation === 'update' && data.status) {
          data.adoptedAt = null
        }
        return data
      },
    ],
    // Pet grids can sit on any page the owners build, so refresh the whole site.
    afterChange: [
      ({ doc }) => {
        safeRevalidate([['/', 'layout']])
        return doc
      },
    ],
    afterDelete: [
      ({ doc }) => {
        safeRevalidate([['/', 'layout']])
        return doc
      },
    ],
  },
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 60 },
    {
      name: 'slug',
      type: 'text',
      unique: true, // a unique constraint is already an index
      admin: {
        position: 'sidebar',
        description: 'Used in the page address. Leave blank to generate it from the name.',
      },
      validate: (value: string | null | undefined) =>
        !value || SLUG_PATTERN.test(value) ? true : 'Use lowercase letters, numbers and single dashes only.',
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'available',
      index: true,
      options: [...STATUSES],
      admin: { position: 'sidebar' },
    },
    {
      name: 'featured',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: { position: 'sidebar', description: 'Show in "featured" pet grids on pages.' },
    },
    {
      name: 'unlisted',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description:
          'Hide from the catalog, pet grids and search engines. Anyone with the direct link can still open the page.',
      },
    },
    {
      name: 'urgent',
      type: 'checkbox',
      defaultValue: false,
      admin: { position: 'sidebar', description: 'Needs a home soon. Pages can highlight urgent pets.' },
    },
    {
      name: 'adoptedAt',
      type: 'date',
      admin: { position: 'sidebar', readOnly: true, description: 'Set automatically when marked adopted.' },
    },
    {
      // Tabs only organise the admin form. They do not change where the data is stored.
      type: 'tabs',
      tabs: [
        {
          label: 'Basics',
          fields: [
            {
              type: 'row',
              fields: [
                { name: 'species', type: 'select', required: true, defaultValue: 'cat', index: true, options: [...SPECIES] },
                { name: 'breed', type: 'text' },
                { name: 'sex', type: 'select', defaultValue: 'unknown', options: [...SEXES] },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'ageGroup', type: 'select', options: [...AGE_GROUPS] },
                {
                  name: 'ageDescription',
                  type: 'text',
                  maxLength: 40,
                  admin: { description: 'For example "about 3 months" or "2 years".' },
                },
                { name: 'size', type: 'select', options: [...SIZES] },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'birthDate',
                  type: 'date',
                  admin: {
                    date: { pickerAppearance: 'dayOnly' },
                    description: 'Optional. An approximate date is fine. Lets pages work out an up-to-date age.',
                  },
                },
                { name: 'color', type: 'text', maxLength: 60, admin: { description: 'Coat colour or markings.' } },
              ],
            },
            {
              name: 'location',
              type: 'text',
              admin: { description: 'City or area where the pet is, for example "Petaling Jaya, Selangor".' },
            },
          ],
        },
        {
          label: 'Health and behaviour',
          fields: [
            {
              type: 'row',
              fields: [
                { name: 'vaccinated', type: 'checkbox', defaultValue: false },
                { name: 'neutered', type: 'checkbox', defaultValue: false, label: 'Neutered / spayed' },
                { name: 'microchipped', type: 'checkbox', defaultValue: false },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'houseTrained', type: 'checkbox', defaultValue: false },
                { name: 'specialNeeds', type: 'checkbox', defaultValue: false },
              ],
            },
            {
              name: 'healthNotes',
              type: 'textarea',
              maxLength: 500,
              admin: { description: 'Anything adopters should know: medication, conditions, care needs.' },
            },
            { name: 'temperament', type: 'select', hasMany: true, options: [...TEMPERAMENTS] },
            {
              name: 'goodWith',
              type: 'select',
              hasMany: true,
              options: [...GOOD_WITH],
              admin: { description: 'Who this pet is known to get along with.' },
            },
          ],
        },
        {
          label: 'Photos and story',
          fields: [
            {
              name: 'photos',
              type: 'upload',
              relationTo: 'media',
              hasMany: true,
              required: true,
              minRows: 1,
              maxRows: 10,
              admin: { description: 'The first photo is used as the cover image.' },
            },
            { name: 'description', type: 'richText' },
            {
              name: 'videoUrl',
              type: 'text',
              validate: validateWebUrl,
              admin: { description: 'Optional link to a video, starting with https://.' },
            },
          ],
        },
        {
          label: 'Adoption',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'adoptionFee',
                  type: 'number',
                  min: 0,
                  admin: { description: 'In your local currency. Leave empty if there is no fixed fee.' },
                },
                { name: 'rescuedAt', type: 'date', admin: { date: { pickerAppearance: 'dayOnly' } } },
              ],
            },
            {
              name: 'contactWhatsApp',
              type: 'text',
              label: 'WhatsApp number for this pet',
              validate: (value: string | null | undefined) =>
                !value || normalizePhone(value) !== '' || 'Enter a valid number, for example +60 12-345 6789.',
              admin: {
                description: 'Optional. Use it when a foster looks after this pet. Leave empty to use the site number.',
              },
            },
          ],
        },
        {
          label: 'SEO',
          description: 'How this pet looks in search results and when its link is shared. All optional.',
          fields: [
            {
              name: 'seo',
              type: 'group',
              label: false,
              fields: [
                {
                  name: 'title',
                  type: 'text',
                  maxLength: 70,
                  admin: { description: 'Leave empty to use "[name] is looking for a home".' },
                },
                {
                  name: 'description',
                  type: 'textarea',
                  maxLength: 160,
                  admin: { description: 'Leave empty to use a summary built from species, breed, age and location.' },
                },
                {
                  name: 'image',
                  type: 'upload',
                  relationTo: 'media',
                  label: 'Share image',
                  admin: { description: 'Leave empty to use the first photo.' },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}
