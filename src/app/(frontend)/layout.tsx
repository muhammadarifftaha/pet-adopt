import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import React from 'react'

import { SmartLink } from '@/components/site/SmartLink'
import { SocialLinks } from '@/components/site/SocialIcons'
import { WhatsAppButton } from '@/components/site/WhatsAppButton'
import { mediaOf, getSettings } from '@/lib/queries'
import { fillMessage } from '@/lib/whatsapp'

import './styles.css'

const serverURL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings()
  return {
    metadataBase: new URL(serverURL),
    title: { default: settings.siteName, template: `%s | ${settings.siteName}` },
    description: settings.tagline ?? undefined,
    openGraph: { siteName: settings.siteName, type: 'website' },
  }
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export default async function FrontendLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings()
  const logo = mediaOf(settings.logo)
  const primary = settings.primaryColor && HEX.test(settings.primaryColor) ? settings.primaryColor : '#e8590c'
  const nav = settings.nav?.length
    ? settings.nav
    : [
        { label: 'Pets', href: '/pets' },
      ]

  return (
    <html lang="en">
      <body style={{ ['--primary' as string]: primary }}>
        <header className="site-header">
          <div className="container header-inner">
            <Link href="/" className="brand">
              {logo ? <Image src={logo.url} alt={logo.alt || settings.siteName} width={40} height={40} className="brand-logo" /> : null}
              <span>{settings.siteName}</span>
            </Link>
            <nav className="nav">
              {nav.map((item, i) => (
                <SmartLink key={`${item.href}-${i}`} href={item.href}>
                  {item.label}
                </SmartLink>
              ))}
              <WhatsAppButton
                phone={settings.whatsappNumber}
                message={fillMessage(settings.whatsappMessage, null)}
                label="WhatsApp"
                className="btn-small"
              />
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <div className="container footer-inner">
            <div>
              <strong>{settings.siteName}</strong>
              {settings.footerText && <p className="pre-line">{settings.footerText}</p>}
            </div>
            <SocialLinks items={settings.socials} />
          </div>
        </footer>
      </body>
    </html>
  )
}
