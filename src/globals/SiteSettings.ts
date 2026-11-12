import type { GlobalConfig } from 'payload'

import { isOwner } from '../lib/access'
import { validateLink, validateWebUrl } from '../lib/links'
import { SOCIAL_PLATFORMS } from '../lib/options'
import { safeRevalidate } from '../lib/revalidate'
import { normalizePhone } from '../lib/whatsapp'

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: 'Site settings',
  access: {
    read: () => true,
    update: isOwner,
  },
  hooks: {
    afterChange: [
      ({ doc }) => {
        safeRevalidate([['/', 'layout']])
        return doc
      },
    ],
  },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Brand',
          fields: [
            { name: 'siteName', type: 'text', required: true, defaultValue: 'Pet Adopt' },
            { name: 'tagline', type: 'text', defaultValue: 'Find your new best friend' },
            { name: 'logo', type: 'upload', relationTo: 'media' },
            {
              name: 'primaryColor',
              type: 'text',
              defaultValue: '#e8590c',
              admin: { description: 'Hex colour used for buttons and links, for example #e8590c.' },
              validate: (value: string | null | undefined) =>
                !value || HEX_COLOR.test(value) ? true : 'Use a hex colour such as #e8590c.',
            },
          ],
        },
        {
          label: 'Contact',
          fields: [
            {
              name: 'whatsappNumber',
              type: 'text',
              validate: (value: string | null | undefined) =>
                !value || normalizePhone(value) !== '' || 'Enter a valid number, for example +60 12-345 6789.',
              admin: {
                description:
                  'Visitors contact you here. Local numbers (starting with 0) get the default country code added.',
              },
            },
            {
              name: 'whatsappMessage',
              type: 'text',
              defaultValue: "Hi! I'm interested in adopting {pet}.",
              admin: { description: '{pet} is replaced with the pet\'s name on pet pages.' },
            },
            { name: 'address', type: 'textarea' },
            { name: 'openingHours', type: 'textarea' },
            {
              name: 'socials',
              type: 'array',
              labels: { singular: 'Social link', plural: 'Social links' },
              fields: [
                {
                  type: 'row',
                  fields: [
                    { name: 'platform', type: 'select', required: true, options: [...SOCIAL_PLATFORMS] },
                    { name: 'url', type: 'text', required: true, validate: validateWebUrl },
                  ],
                },
              ],
            },
          ],
        },
        {
          label: 'Navigation',
          fields: [
            {
              name: 'nav',
              type: 'array',
              labels: { singular: 'Menu item', plural: 'Menu items' },
              admin: { description: 'Links shown in the header, for example /pets or /about.' },
              fields: [
                {
                  type: 'row',
                  fields: [
                    { name: 'label', type: 'text', required: true },
                    { name: 'href', type: 'text', required: true, validate: validateLink },
                  ],
                },
              ],
            },
            { name: 'footerText', type: 'textarea' },
          ],
        },
      ],
    },
  ],
}
