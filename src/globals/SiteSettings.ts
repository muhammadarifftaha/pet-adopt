import type { Field, GlobalConfig } from 'payload'

import { isAdmin } from '../lib/access'
import { validateLink, validateWebUrl } from '../lib/links'
import { SOCIAL_PLATFORMS } from '../lib/options'
import { safeRevalidate } from '../lib/revalidate'
import {
  BUTTON_OPTIONS,
  DENSITY_OPTIONS,
  FONT_OPTIONS,
  PRESET_HELP,
  PRESET_OPTIONS,
  RADIUS_OPTIONS,
  SHADOW_OPTIONS,
  TEXT_SIZE_OPTIONS,
  contrastProblem,
  validateHexColor,
  type Mode,
  type ThemeSettings,
} from '../lib/theme'
import { normalizePhone } from '../lib/whatsapp'

// A hex colour that also keeps text readable. The text colour is checked against the background and
// the cards, so the same check sits on all three fields and the error shows where it was caused.
const readableColor =
  (mode: Mode) =>
  (value: string | null | undefined, { data }: { data?: unknown }) => {
    const hex = validateHexColor(value)
    if (hex !== true) return hex
    const input = data as ThemeSettings | undefined
    if (!input?.customize) return true
    return contrastProblem(input, mode) ?? true
  }

// One set of colour overrides (light or dark). Empty fields follow the preset.
const colorOverrides = (name: Mode, label: string): Field => ({
  name,
  type: 'group',
  label,
  admin: { description: 'Hex colours such as #1f2937. Leave a colour empty to keep the preset\'s.' },
  fields: [
    {
      type: 'row',
      fields: [
        { name: 'primary', type: 'text', label: 'Brand colour', validate: validateHexColor },
        { name: 'background', type: 'text', label: 'Page background', validate: readableColor(name) },
        { name: 'surface', type: 'text', label: 'Cards and fields', validate: readableColor(name) },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'text', type: 'text', label: 'Text', validate: readableColor(name) },
        { name: 'tint', type: 'text', label: 'Soft highlight (banners, hero)', validate: validateHexColor },
      ],
    },
  ],
})

export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: 'Site settings',
  access: {
    read: () => true,
    // Site-wide settings (WhatsApp number, menu, brand) are for admins only.
    update: isAdmin,
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
              label: 'Brand colour (optional)',
              admin: {
                description:
                  'Hex colour for buttons and links, for example #e8590c. Leave empty to use the theme\'s own colour (see the Theme tab). Pale colours are adjusted automatically so text stays readable.',
              },
              validate: validateHexColor,
            },
          ],
        },
        {
          label: 'Theme',
          description: 'The look of the whole site: colours, fonts, corners, shadows and spacing.',
          fields: [
            {
              name: 'theme',
              type: 'select',
              defaultValue: 'sunrise',
              options: [...PRESET_OPTIONS],
              admin: { description: PRESET_HELP },
            },
            {
              name: 'allowModeToggle',
              type: 'checkbox',
              defaultValue: true,
              label: 'Let visitors switch between light and dark',
              admin: {
                description:
                  'Shows a light/dark button in the header and follows each visitor\'s device setting. Untick to keep the site light only.',
              },
            },
            {
              name: 'customize',
              type: 'checkbox',
              defaultValue: false,
              label: 'Customise this theme',
              admin: {
                description:
                  'Adjust fonts, shape, spacing and colours on top of the theme. Anything you leave empty follows the theme.',
              },
            },
            {
              name: 'customTheme',
              type: 'group',
              label: 'Customisation',
              admin: { condition: (data) => Boolean(data?.customize) },
              fields: [
                {
                  type: 'row',
                  fields: [
                    { name: 'headingFont', type: 'select', options: [...FONT_OPTIONS], admin: { description: 'Headings and the site name.' } },
                    { name: 'bodyFont', type: 'select', options: [...FONT_OPTIONS], admin: { description: 'Everything else.' } },
                  ],
                },
                {
                  type: 'row',
                  fields: [
                    { name: 'radius', type: 'select', label: 'Corners', options: [...RADIUS_OPTIONS], admin: { description: 'Cards, photos and fields.' } },
                    { name: 'button', type: 'select', label: 'Buttons and badges', options: [...BUTTON_OPTIONS] },
                  ],
                },
                {
                  type: 'row',
                  fields: [
                    { name: 'shadow', type: 'select', label: 'Shadows', options: [...SHADOW_OPTIONS] },
                    { name: 'density', type: 'select', label: 'Spacing', options: [...DENSITY_OPTIONS] },
                    { name: 'textSize', type: 'select', label: 'Text size', options: [...TEXT_SIZE_OPTIONS] },
                  ],
                },
                colorOverrides('light', 'Light colours'),
                colorOverrides('dark', 'Dark colours'),
              ],
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
