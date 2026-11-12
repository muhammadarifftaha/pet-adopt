import type { CollectionConfig } from 'payload'

import { isOwner } from '../lib/access'

// The site owners. Visitors never sign in. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD
// so the first owner exists before the site is reachable (see src/lib/ensureOwner.ts);
// otherwise the first visitor to /admin gets to create it. After that, only signed-in
// owners can add more.
export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  auth: {
    tokenExpiration: 60 * 60 * 2, // sessions last two hours
    maxLoginAttempts: 5,
    lockTime: 10 * 60 * 1000, // ten minutes
    cookies: {
      // Send the session cookie over HTTPS only once the site runs in production.
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
    },
  },
  access: {
    create: isOwner,
    read: isOwner,
    update: isOwner,
    delete: isOwner,
  },
  hooks: {
    // Deleting the last account would reopen the public "create first user" screen.
    beforeDelete: [
      async ({ req }) => {
        const { totalDocs } = await req.payload.count({ collection: 'users', req })
        if (totalDocs <= 1) {
          throw new Error('The last owner account cannot be deleted.')
        }
      },
    ],
  },
  fields: [{ name: 'name', type: 'text' }],
}
