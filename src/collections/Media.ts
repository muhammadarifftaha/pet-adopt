import type { CollectionConfig } from 'payload'

import { isOwner } from '../lib/access'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: () => true,
    create: isOwner,
    update: isOwner,
    delete: isOwner,
  },
  admin: {
    useAsTitle: 'alt',
  },
  hooks: {
    // Deleting an image that is still in use would strip a pet's photos or a page's share image.
    beforeDelete: [
      async ({ id, req }) => {
        const [pets, petShares, pages] = await Promise.all([
          req.payload.count({ collection: 'pets', where: { photos: { equals: id } }, req }),
          req.payload.count({ collection: 'pets', where: { 'seo.image': { equals: id } }, req }),
          req.payload.count({ collection: 'pages', where: { 'seo.image': { equals: id } }, req }),
        ])
        const petCount = pets.totalDocs + petShares.totalDocs
        if (petCount + pages.totalDocs > 0) {
          throw new Error(
            `This image is still used by ${petCount} pet(s) and ${pages.totalDocs} page(s). Replace it there first.`,
          )
        }
      },
    ],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
      admin: { description: 'Short description of the image, used for accessibility and SEO.' },
    },
  ],
  upload: {
    // No SVG: an uploaded SVG can carry script and would run on the site's own origin.
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'],
    adminThumbnail: 'thumbnail',
    imageSizes: [
      { name: 'thumbnail', width: 320, height: 240, position: 'centre' },
      { name: 'card', width: 800 },
    ],
  },
}
