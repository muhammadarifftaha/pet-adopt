import type { Access } from 'payload'

/** Any signed-in team member (admin or editor): pets, pages and media. */
export const isOwner: Access = ({ req }) => Boolean(req.user)

/** Admins only: managing users and site settings. */
export const isAdmin: Access = ({ req }) => req.user?.role === 'admin'
