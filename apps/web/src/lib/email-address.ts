// One mailbox: no spaces, and none of the characters a mailer reads as a list, a display name or a
// route (`<>()",;:[]\`), so `a@x.com, b@y.com` is refused. The same rule as the form builder's
// EMAIL_PATTERN.
const EMAIL_PATTERN = /^[^\s@<>()",;:[\]\\]+@[^\s@<>()",;:[\]\\]+\.[^\s@<>()",;:[\]\\]+$/

/** Whether `value` is one email address (at most 254 characters). Trim it first. */
export function isEmailAddress(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value)
}
