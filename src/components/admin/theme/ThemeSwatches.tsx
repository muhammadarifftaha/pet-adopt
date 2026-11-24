import React from 'react'

import { resolved, type CustomTheme } from './theme-utils'

// A theme at a glance: its heading font and, for light and dark, the page, card, brand and text
// colours, drawn as a tiny card in those colours. Decorative (the theme's name says what it is).
export function ThemeSwatches({ base, settings }: { base: string; settings?: CustomTheme | null }) {
  const theme = resolved(base, settings)
  return (
    <div className="grid grid-cols-2 gap-2" aria-hidden="true">
      {(['light', 'dark'] as const).map((mode) => {
        const t = theme[mode]
        return (
          <div key={mode} className="rounded-md border p-2" style={{ background: t['--bg'], color: t['--ink'] }}>
            <div className="rounded p-2" style={{ background: t['--surface'], boxShadow: '0 0 0 1px rgb(0 0 0 / 0.08)' }}>
              <div className="text-base leading-tight" style={{ fontFamily: theme.shared['--font-heading'], fontWeight: Number(theme.shared['--heading-weight']) || 700 }}>
                Aa
              </div>
              <div className="mt-1 flex items-center gap-1">
                <span className="h-3 w-6 rounded-full" style={{ background: t['--primary'] }} />
                <span className="h-3 w-3 rounded-full" style={{ background: t['--tint'] }} />
                <span className="h-1.5 flex-1 rounded-full" style={{ background: t['--muted'] }} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
