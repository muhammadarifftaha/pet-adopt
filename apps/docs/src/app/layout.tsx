import '@fontsource-variable/inter'
import './global.css'

import type { Metadata } from 'next'
import { RootProvider } from 'fumadocs-ui/provider/next'

import { appName } from '@/lib/shared'

export const metadata: Metadata = {
  title: { default: `${appName} docs`, template: `%s · ${appName}` },
  description: 'Set up, run and extend Pet Adopt, the open-source storefront for adoptable pets.',
}

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
