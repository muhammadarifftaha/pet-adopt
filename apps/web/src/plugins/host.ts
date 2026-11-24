// The app's services for plugins (`host()` in @pet-adopt/plugin-sdk): who is signed in, the action
// wrapper, the client address, rate limits, phone checks, email and safe logging. A plugin package
// cannot import the app, so it reaches these through the SDK. Loading this module registers them;
// registry.ts and instrumentation.ts load it before any plugin code runs.
import { provideHost } from '@pet-adopt/plugin-sdk'
import { headers } from 'next/headers'

import { toE164, validatePhone } from '@/lib/phone'
import { logError, run } from '@/server/result'
import { requireAdmin, requireUser } from '@/server/session'
import { clientAddress, consumeAttempt } from '@/server/throttle'

import { getEmailSender } from './registry'

provideHost({
  requireUser,
  requireAdmin,
  run,
  clientAddress: async () => clientAddress(await headers()),
  // Namespaced, so a plugin cannot touch the sign-in counters (and so they are purged with the rest).
  consumeAttempt: (key, rule) => consumeAttempt(`plugin:${key}`, rule),
  phone: { validate: (raw) => validatePhone(raw), toE164: (raw) => toE164(raw) },
  emailSender: () => getEmailSender(),
  logError,
})
