import { NextResponse } from 'next/server'

// Lightweight liveness probe for hosting platforms and uptime monitors.
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ ok: true })
}
