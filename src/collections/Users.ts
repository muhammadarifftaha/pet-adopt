import type { Access, CollectionConfig, FieldAccess, PayloadRequest } from 'payload'

import { isAdmin } from '../lib/access'
import { ROLES } from '../lib/options'

// The people who sign in. Visitors never do. There are two roles:
//  - admin: everything, including managing users and site settings.
//  - editor: pets, pages and media. Can change only their own name and password.
// Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD so the first admin exists before the site is
// reachable (see src/lib/ensureOwner.ts); otherwise the first visitor to /admin gets to create it.
// The first account is always an admin, whatever role it is given.

// Admins see and change every user. Everyone else only sees and changes their own account.
const adminOrSelf: Access = ({ req }) => {
  if (!req.user) return false
  if (req.user.role === 'admin') return true
  return { id: { equals: req.user.id } }
}

// Only admins may change a role, so an editor cannot promote themselves.
const adminOnlyField: FieldAccess = ({ req }) => req.user?.role === 'admin'

const countAdmins = async (req: PayloadRequest) =>
  (await req.payload.count({ collection: 'users', where: { role: { equals: 'admin' } }, req })).totalDocs

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'role'],
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
    create: isAdmin,
    read: adminOrSelf,
    update: adminOrSelf,
    delete: isAdmin,
  },
  hooks: {
    beforeChange: [
      async ({ data, operation, originalDoc, req }) => {
        if (operation === 'create') {
          // The very first account must be an admin, or nobody could manage the site.
          const { totalDocs } = await req.payload.count({ collection: 'users', req })
          if (totalDocs === 0) data.role = 'admin'
        } else if (originalDoc?.role === 'admin' && data.role && data.role !== 'admin') {
          // Demoting the last admin would leave nobody able to manage users and settings.
          if ((await countAdmins(req)) <= 1) throw new Error('The last admin cannot be made an editor.')
        }
        return data
      },
    ],
    beforeDelete: [
      async ({ id, req }) => {
        // The last admin cannot be deleted. (That also means the site always has a user, so the
        // public "create first user" screen never reopens.)
        const target = await req.payload.findByID({ collection: 'users', id, depth: 0, req })
        if (target.role === 'admin' && (await countAdmins(req)) <= 1) {
          throw new Error('The last admin account cannot be deleted.')
        }
      },
    ],
  },
  fields: [
    { name: 'name', type: 'text' },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'editor',
      options: [...ROLES],
      access: { update: adminOnlyField },
      admin: {
        position: 'sidebar',
        description: 'Admins also manage users and site settings. Editors manage pets, pages and media.',
      },
    },
  ],
}
