'use client'

import { formatWhen } from '@pet-adopt/plugin-sdk'
import { Badge } from '@pet-adopt/ui/components/badge'
import { Button } from '@pet-adopt/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pet-adopt/ui/components/card'
import { Field, FieldDescription, FieldLabel } from '@pet-adopt/ui/components/field'
import { Input } from '@pet-adopt/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pet-adopt/ui/components/select'
import { Switch } from '@pet-adopt/ui/components/switch'
import React, { useRef, useState, useTransition } from 'react'

import { checkCaptchaKeysAction, saveCaptchaSettingsAction } from '../actions'
import type { CaptchaSettingsView } from '../captcha'
import { CAPTCHA_INFO, CAPTCHA_PROVIDERS, type CaptchaProvider } from '../captcha-providers'
import { CaptchaWidget, type CaptchaHandle } from '../captcha-widget'

const SCORES = [
  { value: '30', label: '0.3 (lenient)' },
  { value: '50', label: '0.5 (Google’s suggestion)' },
  { value: '70', label: '0.7 (strict)' },
]

// The screen: choose a service, paste its keys, save, then "Check these keys" with the real widget.
// Only checked keys can protect forms (a typo would otherwise stop every form), and the secret key
// is never shown again once saved (a blank box keeps it).
export function SpamProtectionForm({ initial, canEdit, timeZone = null }: { initial: CaptchaSettingsView; canEdit: boolean; timeZone?: string | null }) {
  const [view, setView] = useState(initial)
  const [provider, setProvider] = useState<string>(initial.provider ?? '')
  const [siteKey, setSiteKey] = useState(initial.siteKey)
  const [secret, setSecret] = useState('')
  const [clearSecret, setClearSecret] = useState(false)
  const [minScore, setMinScore] = useState(String(initial.minScore))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const widget = useRef<CaptchaHandle>(null)

  const chosen = (provider || null) as CaptchaProvider | null
  // What is typed differs from what is saved: save before checking or switching on.
  const unsaved = chosen !== view.provider || siteKey.trim() !== view.siteKey || Boolean(secret.trim()) || clearSecret || Number(minScore) !== view.minScore
  const items = [{ value: '', label: 'Off (no spam check)' }, ...CAPTCHA_PROVIDERS.map((id) => ({ value: id, label: CAPTCHA_INFO[id].label }))]

  // Buttons use aria-disabled while a request runs (so focus stays put); each handler returns early instead.
  const save = (enabled: boolean) => {
    if (pending) return
    startTransition(async () => {
      const result = await saveCaptchaSettingsAction({ provider: chosen, siteKey, secret, clearSecret, minScore: Number(minScore), enabled })
      if (result.ok) {
        setView(result.data)
        setSecret('')
        setClearSecret(false)
        setErrors({})
        setNotice({
          ok: true,
          text: !result.data.provider ? 'Saved. Forms have no spam check.' : result.data.active ? 'Saved. Forms are protected.' : 'Saved. Check the keys below to protect forms.',
        })
      } else {
        setErrors(result.fieldErrors ?? {})
        setNotice({ ok: false, text: result.error })
      }
    })
  }

  // One check at a time: a second press would verify a token that was already used, and fail.
  const check = () => {
    if (pending) return
    startTransition(async () => {
      const token = await widget.current?.getToken()
      if (!token) {
        setNotice({ ok: false, text: CAPTCHA_INFO[view.provider!].invisible ? 'The check could not run. Reload the page and try again.' : 'Complete the check in the box first.' })
        return
      }
      const result = await checkCaptchaKeysAction(token)
      widget.current?.reset()
      if (result.ok) {
        setView(result.data)
        setNotice({ ok: true, text: 'The keys work. Switch on “Protect forms” to use them.' })
      } else setNotice({ ok: false, text: result.error })
    })
  }

  const toggleProtection = (checked: boolean) => {
    if (pending) return
    startTransition(async () => {
      const result = await saveCaptchaSettingsAction({ provider: view.provider, siteKey: view.siteKey, minScore: view.minScore, enabled: checked })
      if (result.ok) {
        setView(result.data)
        setNotice({ ok: true, text: result.data.active ? 'Forms are protected.' : 'Spam protection is switched off.' })
      } else setNotice({ ok: false, text: result.fieldErrors?.enabled ?? result.error })
    })
  }

  const status = !view.provider ? (
    <Badge variant="secondary">Off</Badge>
  ) : view.active ? (
    <Badge>On: forms are protected</Badge>
  ) : view.checkedAt ? (
    <Badge variant="outline">Keys checked, switched off</Badge>
  ) : (
    <Badge variant="outline">Keys not checked: forms are not protected</Badge>
  )

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">Spam protection {status}</CardTitle>
          <CardDescription>
            A check from a captcha service before a form is sent, with your own keys from that service. Forms also have a hidden spam trap and
            sending limits either way.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset disabled={!canEdit} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
            <Field>
              <FieldLabel htmlFor="captcha-provider">Service</FieldLabel>
              <Select items={items} value={provider} onValueChange={(value) => setProvider(value ?? '')}>
                <SelectTrigger id="captcha-provider" className="w-full" aria-describedby="captcha-provider-note">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.value || 'off'} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription id="captcha-provider-note">
                {chosen ? (
                  <>
                    {CAPTCHA_INFO[chosen].note} Make keys at <span className="break-all font-mono text-xs">{CAPTCHA_INFO[chosen].keysAt}</span> and add this site’s
                    domain there. Mention {CAPTCHA_INFO[chosen].label} in your privacy policy: it processes visitors’ data to tell people from bots.
                  </>
                ) : (
                  'Forms are sent without a spam check.'
                )}
              </FieldDescription>
              {errors.provider ? <p className="text-sm text-destructive">{errors.provider}</p> : null}
            </Field>

            {chosen ? (
              <>
                <Field data-invalid={errors.siteKey ? true : undefined}>
                  <FieldLabel htmlFor="captcha-site-key">Site key</FieldLabel>
                  <Input
                    id="captcha-site-key"
                    value={siteKey}
                    onChange={(event) => setSiteKey(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={errors.siteKey ? true : undefined}
                    aria-describedby="captcha-site-key-note"
                  />
                  <FieldDescription id="captcha-site-key-note">Public: it is sent to visitors’ browsers.</FieldDescription>
                  {errors.siteKey ? <p className="text-sm text-destructive">{errors.siteKey}</p> : null}
                </Field>
                <Field data-invalid={errors.secret ? true : undefined}>
                  <FieldLabel htmlFor="captcha-secret">Secret key</FieldLabel>
                  <Input
                    id="captcha-secret"
                    type="password"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    autoComplete="new-password"
                    placeholder={view.secretSet && !view.secretUnreadable ? 'Saved (leave blank to keep it)' : ''}
                    aria-invalid={errors.secret ? true : undefined}
                    aria-describedby="captcha-secret-note"
                  />
                  <FieldDescription id="captcha-secret-note">
                    {view.secretUnreadable
                      ? 'The saved secret key can no longer be read (the site’s secret changed). Paste it again.'
                      : 'Stored encrypted and never shown again.'}
                  </FieldDescription>
                  {errors.secret ? <p className="text-sm text-destructive">{errors.secret}</p> : null}
                  {view.secretSet ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={clearSecret} onChange={(event) => setClearSecret(event.target.checked)} />
                      Remove the saved secret key
                    </label>
                  ) : null}
                </Field>
                {chosen === 'recaptcha-v3' ? (
                  <Field>
                    <FieldLabel htmlFor="captcha-score">Minimum score</FieldLabel>
                    <Select items={SCORES} value={minScore} onValueChange={(value) => setMinScore(value ?? '50')}>
                      <SelectTrigger id="captcha-score" className="w-full" aria-describedby="captcha-score-note">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SCORES.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription id="captcha-score-note">Forms from visitors scored below this are refused.</FieldDescription>
                  </Field>
                ) : null}
              </>
            ) : null}

            {canEdit ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => save(view.enabled && !unsaved)} aria-disabled={pending || undefined}>
                  {pending ? 'Saving…' : 'Save'}
                </Button>
                {unsaved && view.provider ? <span className="text-sm text-muted-foreground">Saving new keys switches protection off until they are checked.</span> : null}
              </div>
            ) : null}
          </fieldset>
        </CardContent>
      </Card>

      {view.provider && view.siteKey && view.secretSet && !view.secretUnreadable ? (
        <Card>
          <CardHeader>
            <CardTitle>Check these keys</CardTitle>
            <CardDescription>
              {view.checkedAt ? `Last checked ${formatWhen(view.checkedAt, timeZone)}.` : 'Not checked yet.'} The saved keys, tried for real: the check below comes from{' '}
              {CAPTCHA_INFO[view.provider].label} and is verified with the secret key.
              {CAPTCHA_INFO[view.provider].invisible ? ' It is invisible: just press the button.' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <CaptchaWidget key={`${view.provider}:${view.siteKey}`} ref={widget} captcha={{ provider: view.provider, siteKey: view.siteKey }} />
            {canEdit ? (
              <div className="flex flex-wrap items-center gap-4">
                <Button type="button" variant="outline" onClick={check} aria-disabled={pending || undefined}>
                  Check these keys
                </Button>
                <label className="flex items-center gap-2 text-sm">
                  {/* Natively disabled only while it cannot be used (keys not checked, or unsaved changes); while a request runs it stays focusable. */}
                  <Switch
                    checked={view.enabled}
                    disabled={!view.checkedAt || unsaved}
                    aria-disabled={pending || undefined}
                    onCheckedChange={toggleProtection}
                  />
                  Protect forms
                </label>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <p role="status" aria-live="polite" className={notice?.ok === false ? 'text-sm text-destructive' : 'text-sm'}>
        {notice?.text ?? ''}
      </p>
    </div>
  )
}
