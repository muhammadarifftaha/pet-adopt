'use client'

import type { SiteSetting } from '@/server/types'

// TODO(ui): tabs Brand, Theme, Contact, Navigation (ADMIN_UI.md section 7).
// Save with `updateSettingsAction(input)` from '@/server/actions/settings'; send only what changed.
// Nested field errors use dotted keys: customTheme.light.text, nav.0.href, socials.1.url.
// Theme presets: PRESET_OPTIONS and PRESET_HELP in '@/lib/theme'.
export function SettingsForm({ settings }: { settings: SiteSetting }) {
  return <p className="text-sm text-muted-foreground">Settings form for “{settings.siteName}” goes here.</p>
}
