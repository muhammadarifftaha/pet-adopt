import React from 'react'

import { MODE_STORAGE_KEY, resolveTheme, themeCss, type ThemeSettings } from '@/lib/theme'

// Runs before the first paint so a visitor who chose dark does not see a flash of the light theme.
// A constant string: nothing from the settings goes into it.
const PRE_PAINT = `(function(){try{var m=localStorage.getItem('${MODE_STORAGE_KEY}');if(m==='dark'||m==='light'){document.documentElement.setAttribute('data-mode',m)}}catch(e){}})()`

/**
 * Applies the site theme. Render it inside <head>. The CSS comes from themeCss, which only emits
 * values that were validated against the preset lists or the hex pattern, so settings can never
 * inject markup or rules.
 */
export function ThemeStyle({ settings, lightOnly = false }: { settings: ThemeSettings; lightOnly?: boolean }) {
  const theme = resolveTheme(settings)
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeCss(theme, { lightOnly }) }} />
      {theme.allowModeToggle && !lightOnly ? <script dangerouslySetInnerHTML={{ __html: PRE_PAINT }} /> : null}
    </>
  )
}
