'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { FiAlertCircle, FiCheckCircle, FiX } from 'react-icons/fi'

// The builders' save/publish/send results, as a toast in the bottom corner instead of text in the
// header. Plain CSS in editor.css (the builders do not load Tailwind).
//
// Accessibility: the live region is always in the page (a region added together with its text is
// often not announced). Success is polite and closes itself after a few seconds; an error is an
// alert and stays until it is closed, so nobody misses it (WCAG 2.2.1: no time limit on reading it).

export type ToastMessage = { ok: boolean; text: string }

const SUCCESS_MS = 4000

/** `show` puts up a message (the same text twice still shows again); `toast` is rendered once. */
export function useEditorToast() {
  const [current, setCurrent] = useState<(ToastMessage & { id: number }) | null>(null)
  const show = useCallback((message: ToastMessage) => setCurrent((old) => ({ ...message, id: (old?.id ?? 0) + 1 })), [])
  const dismiss = useCallback(() => setCurrent(null), [])

  useEffect(() => {
    if (!current?.ok) return
    const timer = setTimeout(() => setCurrent((now) => (now?.id === current.id ? null : now)), SUCCESS_MS)
    return () => clearTimeout(timer)
  }, [current])

  const toast = (
    <div className="editor-toast-region" role="status" aria-live="polite">
      {current ? (
        <div key={current.id} className={current.ok ? 'editor-toast' : 'editor-toast editor-toast-error'} role={current.ok ? undefined : 'alert'}>
          {current.ok ? <FiCheckCircle aria-hidden /> : <FiAlertCircle aria-hidden />}
          <span>{current.text}</span>
          <button type="button" className="editor-toast-close" onClick={dismiss} aria-label="Close message">
            <FiX aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  )
  return { show, toast }
}
