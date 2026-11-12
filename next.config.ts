import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

const isDev = process.env.NODE_ENV !== 'production'
const siteURL = (process.env.NEXT_PUBLIC_SERVER_URL ?? '').trim()

// Content-Security-Policy for the public site, the Payload admin and the page builder.
//  - Inline scripts stay allowed: Next.js and Payload both emit inline bootstrap scripts, and a
//    nonce would force every page to render per request, which ends the page caching.
//    Everything else is locked down: no other script origins, no eval in production, no plugins,
//    no framing by other sites, forms and <base> only to this site.
//  - Images come from this site (uploads are served through /api/media), plus data:/blob: for
//    previews in the admin.
//  - The only thing that may be embedded is a Google Maps embed (see safeMapEmbed in lib/links.ts).
//  - Development also needs eval (React refresh) and websockets (hot reload).
// Set CSP_REPORT_ONLY=1 to report violations in the browser console without blocking anything.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  'frame-src https://www.google.com/maps/',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  // Only meaningful (and safe) when the site is served over HTTPS.
  ...(siteURL.startsWith('https://') ? ['upgrade-insecure-requests'] : []),
].join('; ')

const nextConfig: NextConfig = {
  images: {
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Stops other sites from framing the site, the admin or the page builder.
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: process.env.CSP_REPORT_ONLY === '1' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy',
            value: contentSecurityPolicy,
          },
        ],
      },
    ]
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
  turbopack: {
    root: path.resolve(dirname),
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
