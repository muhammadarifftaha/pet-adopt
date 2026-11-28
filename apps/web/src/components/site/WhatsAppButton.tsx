import React from 'react'

import { buildWhatsAppUrl } from '@/lib/whatsapp'

type Props = {
  phone?: string | null
  message?: string | null
  label?: string
  variant?: 'primary' | 'outline'
  className?: string
}

export function WhatsAppButton({ phone, message, label = 'Chat on WhatsApp', variant = 'primary', className }: Props) {
  const href = buildWhatsAppUrl(phone, message)
  if (!href) return null
  return (
    <a
      className={`btn btn-${variant}${className ? ` ${className}` : ''}`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
