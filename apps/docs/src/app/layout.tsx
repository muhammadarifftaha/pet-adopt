import '@fontsource-variable/inter'
import './global.css'

import type { Metadata } from 'next'
import { RootProvider } from 'fumadocs-ui/provider/next'

import { appName, siteUrl } from '@/lib/shared'

const description = 'Set up, run and extend Pet Adopt, the open-source storefront for adoptable pets.'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: `${appName} docs`, template: `%s · ${appName}` },
  description,
  openGraph: { siteName: appName, type: 'website', locale: 'en_GB', title: `${appName} docs`, description },
  twitter: { card: 'summary' },
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
