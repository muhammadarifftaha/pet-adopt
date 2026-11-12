import type { CollectionConfig } from 'payload'

import { isOwner } from '../lib/access'
import { AGE_GROUPS, SEXES, SIZES, SPECIES, STATUSES } from '../lib/options'
import { safeRevalidate } from '../lib/revalidate'
import { SLUG_PATTERN, slugify } from '../lib/slugify'

export const Pets: CollectionConfig = {
  slug: 'pets',
  labels: { singular: 'Pet', plural: 'Pets' },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'species', 'status', 'location', 'updatedAt'],
    listSearchableFields: ['name', 'breed', 'location'],
  },
  access: {
    read: () => true,
    create: isOwner,
    update: isOwner,
    delete: isOwner,
  },
  defaultSort: '-createdAt',
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
    { name: 'name', type: 'text', required: true },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
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
      options: [...STATUSES],
      admin: { position: 'sidebar' },
    },
    {
      name: 'featured',
      type: 'checkbox',
      defaultValue: false,
      admin: { position: 'sidebar', description: 'Show in "featured" pet grids on pages.' },
    },
    {
      name: 'adoptedAt',
      type: 'date',
      admin: { position: 'sidebar', readOnly: true, description: 'Set automatically when marked adopted.' },
    },
    {
      type: 'row',
      fields: [
        { name: 'species', type: 'select', required: true, defaultValue: 'cat', options: [...SPECIES] },
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
          admin: { description: 'For example "about 3 months" or "2 years".' },
        },
        { name: 'size', type: 'select', options: [...SIZES] },
      ],
    },
    {
      name: 'location',
      type: 'text',
      admin: { description: 'City or area where the pet is, for example "Petaling Jaya, Selangor".' },
    },
    {
      type: 'row',
      fields: [
        { name: 'vaccinated', type: 'checkbox', defaultValue: false },
        { name: 'neutered', type: 'checkbox', defaultValue: false, label: 'Neutered / spayed' },
      ],
    },
    {
      name: 'photos',
      type: 'upload',
      relationTo: 'media',
      hasMany: true,
      required: true,
      minRows: 1,
      admin: { description: 'The first photo is used as the cover image.' },
    },
    { name: 'description', type: 'richText' },
  ],
}
