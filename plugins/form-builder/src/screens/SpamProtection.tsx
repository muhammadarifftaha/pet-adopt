import { accessPermission, can, type PluginUser } from '@pet-adopt/plugin-sdk'

import { getCaptchaSettings } from '../captcha'
import { SpamProtectionForm } from './SpamProtectionForm'

// Spam protection for public forms (captcha with the owner's own keys): admins and developers
// change it, audit views it (the screen's access level is `admin`).
export async function SpamProtection({ user }: { user: PluginUser }) {
  const settings = await getCaptchaSettings()
  return <SpamProtectionForm initial={settings} canEdit={can(user.role, accessPermission('admin', 'edit'))} />
}
