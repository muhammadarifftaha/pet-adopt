import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

const isDev = process.env.NODE_ENV !== 'production'
const siteURL = (process.env.NEXT_PUBLIC_SERVER_URL ?? '').trim()

// Content-Security-Policy for the public site, the admin and the page builder.
//  - Inline scripts stay allowed: Next.js emits inline bootstrap scripts, and a
//    nonce would force every page to render per request, which ends the page caching.
//    Everything else is locked down: no other script origins, no eval in production, no plugins,
//    no framing by other sites, forms and <base> only to this site.
//  - Images come from this site (uploads are served through /media), plus data:/blob: for
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
  // 'self': the admin pages table previews pages in an iframe (/edit/<id>/preview).
  // YouTube (no-cookie) and Vimeo: the Video block, which only frames URLs built by safeVideoEmbed.
  "frame-src 'self' https://www.google.com/maps/ https://www.youtube-nocookie.com https://player.vimeo.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  // Only meaningful (and safe) when the site is served over HTTPS.
  ...(siteURL.startsWith('https://') ? ['upgrade-insecure-requests'] : []),
].join('; ')

const nextConfig: NextConfig = {
  // Native database drivers and sharp must be loaded from node_modules at runtime, not bundled.
  serverExternalPackages: ['better-sqlite3', 'pg', 'sharp'],
  // Workspace packages ship TypeScript source (no build step), so Next compiles them. A plugin
  // installed from npm as compiled JavaScript does not need to be listed.
  transpilePackages: [
    '@pet-adopt/plugin-sdk',
    '@pet-adopt/plugin-adoption-tips',
    '@pet-adopt/plugin-form-builder',
    '@pet-adopt/plugin-resend-email',
  ],
  experimental: {
    // Uploads go through server actions; the app allows images up to 10 MB.
    serverActions: { bodySizeLimit: '11mb' },
  },
  images: {
    localPatterns: [
      {
        // Uploaded images are served by src/app/media/[...path]/route.ts.
        pathname: '/media/**',
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
  // The monorepo root (two levels up): pnpm installs packages there, and the plugin packages in
  // plugins/ and packages/ live outside this app, so Turbopack must be able to read them.
  turbopack: {
    root: path.resolve(dirname, '../..'),
  },
}

export default nextConfig
