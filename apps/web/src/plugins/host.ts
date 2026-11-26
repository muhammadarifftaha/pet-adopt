// The app's services for plugins (`host()` in @pet-adopt/plugin-sdk): who is signed in, the action
// wrapper, the client address, rate limits, phone checks, email and safe logging. A plugin package
// cannot import the app, so it reaches these through the SDK. Loading this module registers them;
// registry.ts and instrumentation.ts load it before any plugin code runs.
import { provideHost } from '@pet-adopt/plugin-sdk'
import { headers } from 'next/headers'

import { PetStatus } from '@/lib/options'
import { toE164, validatePhone } from '@/lib/phone'
import { logError, run } from '@/server/result'
import { listPetChoices } from '@/server/pets'
import { requirePermission } from '@/server/session'
import { clientAddress, consumeAttempt } from '@/server/throttle'

import { getEmailSender } from './registry'

provideHost({
  requirePermission,
  // Fail closed for plugins written before roles: "a user" means someone who can change the team's
  // plugin content, so an audit (view-only) account cannot write through an older plugin's action.
  requireUser: () => requirePermission('pluginContent:edit'),
  requireAdmin: () => requirePermission('plugins:edit'),
  run,
  clientAddress: async () => clientAddress(await headers()),
  // Namespaced, so a plugin cannot touch the sign-in counters (and so they are purged with the rest).
  consumeAttempt: (key, rule) => consumeAttempt(`plugin:${key}`, rule),
  phone: { validate: (raw) => validatePhone(raw), toE164: (raw) => toE164(raw) },
  choices: async (source) => {
    if (source === 'pets') {
      const pets = await listPetChoices()
      return pets.map((pet) => ({ value: String(pet.id), label: pet.status === PetStatus.Pending ? `${pet.name} (adoption pending)` : pet.name }))
    }
    return []
  },
  emailSender: () => getEmailSender(),
  logError,
})
