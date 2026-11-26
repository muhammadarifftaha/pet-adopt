// The app's services for plugins (`host()` in @pet-adopt/plugin-sdk): who is signed in, the action
// wrapper, the client address, rate limits, phone checks, email and safe logging. A plugin package
// cannot import the app, so it reaches these through the SDK. Loading this module registers them;
// registry.ts and instrumentation.ts load it before any plugin code runs.
import { provideHost } from '@pet-adopt/plugin-sdk'
import { headers } from 'next/headers'

import { PetStatus } from '@/lib/options'
import { toE164, validatePhone } from '@/lib/phone'
import { recordActivity } from '@/server/activity'
import { listEmailTemplates, sendPurposeEmail } from '@/server/email-templates'
import { logError, run } from '@/server/result'
import { listPetChoices } from '@/server/pets'
import { getSessionUser, requirePermission } from '@/server/session'
import { clientAddress, consumeAttempt } from '@/server/throttle'

import { getEmailSender } from '@/server/email'
import { getPrivacyPolicy } from '@/server/privacy'

import { getPluginInfo } from './registry'

/** `<plugin>.<thing>.<verb>`: lower-case words, starting with the name of a plugin in the config. */
const PLUGIN_ACTION = /^([a-z0-9-]+)(\.[a-z0-9-]+)+$/

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
  sendTemplatedEmail: (message) => {
    const purpose = message?.purpose
    if (purpose !== 'team-notification' && purpose !== 'visitor-message') throw new Error(`plugins may send team notifications and visitor messages only, not "${String(purpose)}"`)
    const values = Object.fromEntries(Object.entries(message.values ?? {}).filter(([, value]) => typeof value === 'string').map(([key, value]) => [key, value.slice(0, 500)]))
    return sendPurposeEmail({
      purpose,
      templateId: typeof message.templateId === 'number' ? message.templateId : null,
      fallback: typeof message.fallback === 'string' && /^[a-z0-9-]+:[a-z0-9-]+$/.test(message.fallback) ? message.fallback : null,
      to: message.to,
      values,
      // A message to a visitor never carries details, whatever the plugin passes.
      details: purpose === 'team-notification' ? message.details : undefined,
    })
  },
  privacyPolicy: async () => {
    const policy = await getPrivacyPolicy()
    return { policy: policy ? { title: policy.title, href: policy.href } : null, settingsHref: '/admin/settings?tab=navigation' }
  },
  emailTemplates: async (purpose) => (await listEmailTemplates(purpose)).map(({ id, name, seedKey }) => ({ id, name, seedKey })),
  logError,
  // Plugins log changes made by the signed-in person, under the area `plugins`. An action must start
  // with the name of a configured plugin, so a plugin cannot pass its entries off as the site's own.
  recordActivity: async (entry) => {
    try {
      const match = typeof entry?.action === 'string' ? PLUGIN_ACTION.exec(entry.action) : null
      if (!match || !getPluginInfo(match[1])) throw new Error(`activity action "${String(entry?.action)}" must start with a plugin's name`)
      const user = await getSessionUser()
      if (!user) return
      await recordActivity({
        actor: user,
        action: entry.action,
        area: 'plugins',
        summary: String(entry.summary ?? ''),
        subject: entry.subject ? { id: entry.subject.id, label: entry.subject.label ?? null } : null,
        fields: Array.isArray(entry.fields) ? entry.fields.filter((field): field is string => typeof field === 'string') : null,
      })
    } catch (error) {
      logError(error, 'a plugin could not record activity')
    }
  },
})
