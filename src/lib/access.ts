import type { Access } from 'payload'

export const isOwner: Access = ({ req }) => Boolean(req.user)
