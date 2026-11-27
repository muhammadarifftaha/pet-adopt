'use client'

// The spam check on a visitor's form (and on the "Check these keys" screen): loads the chosen
// service's script once, draws its widget (none for reCAPTCHA v3, which is invisible) and gives
// the form a token when it is sent. Tokens are single-use: `reset()` after every attempt.
// Scripts come from the services' own hosts, which the site's CSP allows (next.config.ts).
import React, { useEffect, useImperativeHandle, useRef, useState } from 'react'

import { CAPTCHA_INFO, type CaptchaProvider, type PublicCaptcha } from './captcha-providers'

export { CAPTCHA_INFO }

export type CaptchaHandle = {
  /** A fresh token, or null when the visitor has not completed the check (or it could not run). */
  getToken(): Promise<string | null>
  /** Ready for another attempt (tokens work once). */
  reset(): void
}

type WidgetApi = {
  render(element: HTMLElement, options: Record<string, unknown>): string | number
  reset(id?: string | number): void
  remove?(id?: string | number): void
  ready?(callback: () => void): void
  execute?(siteKey: string, options: { action: string }): Promise<string>
}

const GLOBAL: Record<CaptchaProvider, 'turnstile' | 'grecaptcha' | 'hcaptcha'> = {
  turnstile: 'turnstile',
  'recaptcha-v3': 'grecaptcha',
  'recaptcha-v2': 'grecaptcha',
  hcaptcha: 'hcaptcha',
}

function scriptUrl(provider: CaptchaProvider, siteKey: string, onload: string): string {
  switch (provider) {
    case 'turnstile':
      return `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=${onload}`
    case 'recaptcha-v2':
      return `https://www.google.com/recaptcha/api.js?render=explicit&onload=${onload}`
    case 'recaptcha-v3':
      return `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}&onload=${onload}`
    case 'hcaptcha':
      return `https://js.hcaptcha.com/1/api.js?render=explicit&onload=${onload}`
  }
}

/** Loads a service's script once per page; resolves with its API. */
const loading = new Map<string, Promise<WidgetApi>>()
function loadApi(provider: CaptchaProvider, siteKey: string): Promise<WidgetApi> {
  const key = `${provider}:${siteKey}`
  const existing = loading.get(key)
  if (existing) return existing
  const promise = new Promise<WidgetApi>((resolve, reject) => {
    const onload = `petAdoptCaptcha${Math.random().toString(36).slice(2)}`
    const win = window as unknown as Record<string, unknown>
    win[onload] = () => {
      delete win[onload]
      resolve(win[GLOBAL[provider]] as WidgetApi)
    }
    const script = document.createElement('script')
    script.src = scriptUrl(provider, siteKey, onload)
    script.async = true
    script.defer = true
    script.onerror = () => {
      loading.delete(key)
      script.remove()
      reject(new Error('captcha script failed to load'))
    }
    document.head.appendChild(script)
  })
  loading.set(key, promise)
  return promise
}

export function CaptchaWidget({ captcha, ref }: { captcha: PublicCaptcha; ref?: React.Ref<CaptchaHandle> }) {
  const box = useRef<HTMLDivElement>(null)
  const api = useRef<WidgetApi | null>(null)
  const widgetId = useRef<string | number | null>(null)
  const token = useRef<string | null>(null)
  const [failed, setFailed] = useState(false)
  const invisible = CAPTCHA_INFO[captcha.provider].invisible

  useEffect(() => {
    let cancelled = false
    const element = box.current
    loadApi(captcha.provider, captcha.siteKey)
      .then((loaded) => {
        if (cancelled) return
        api.current = loaded
        if (invisible || !element) return
        const draw = () => {
          widgetId.current = loaded.render(element, {
            sitekey: captcha.siteKey,
            callback: (value: string) => {
              token.current = value
            },
            'expired-callback': () => {
              token.current = null
            },
            'error-callback': () => {
              token.current = null
            },
          })
        }
        // The script's onload has fired, so the API is ready. Turnstile's own ready() throws when
        // its script was added with async/defer, as this one is, so it is not used for Turnstile.
        if (loaded.ready && captcha.provider !== 'turnstile') loaded.ready(draw)
        else draw()
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      if (api.current?.remove && widgetId.current !== null) api.current.remove(widgetId.current)
      widgetId.current = null
      token.current = null
      if (element) element.replaceChildren()
    }
  }, [captcha.provider, captcha.siteKey, invisible])

  useImperativeHandle(
    ref,
    () => ({
      async getToken() {
        const loaded = api.current
        if (!loaded) return null
        if (captcha.provider === 'recaptcha-v3') {
          return new Promise<string | null>((resolve) => {
            const run = () => loaded.execute!(captcha.siteKey, { action: 'submit' }).then(resolve, () => resolve(null))
            if (loaded.ready && captcha.provider !== 'turnstile') loaded.ready(run)
            else run()
          })
        }
        return token.current
      },
      reset() {
        token.current = null
        if (api.current && widgetId.current !== null) api.current.reset(widgetId.current)
      },
    }),
    [captcha.provider, captcha.siteKey],
  )

  if (failed) {
    return (
      <p className="form-captcha-error" role="alert">
        The spam check could not load (an ad or script blocker can stop it), so this form cannot be sent. Please allow it and reload the page, or contact us another way.
      </p>
    )
  }
  return invisible ? null : <div ref={box} className="form-captcha" />
}
