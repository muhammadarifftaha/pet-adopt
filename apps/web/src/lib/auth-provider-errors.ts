// What a sign-in provider's callback error code (?error=<code>, from Better Auth) means for people,
// on the sign-in page and the Account page. Codes we do not know get a general message: the code
// itself is shown, so an admin can look it up.

/** The message for a failed sign-in with a provider. */
export function providerSignInError(code: string): string {
  switch (code) {
    case 'account_not_linked':
    case 'signup_disabled':
      return 'That account is not connected to an account here. Sign in with your password, then connect it on your Account page.'
    case 'ACCOUNT_ARCHIVED':
      return 'This account is archived. Ask an admin to restore it.'
    case 'access_denied':
      return 'Signing in was cancelled at the provider.'
    case 'email_not_found':
      return 'The provider did not share an email address. Ask an admin to check its scopes.'
    default:
      return `Signing in with the provider did not work (${code}). Try again, or sign in with your password.`
  }
}

/** The message for a failed attempt to connect a provider on the Account page. */
export function providerConnectError(code: string): string {
  switch (code) {
    case 'account_already_linked_to_different_user':
      return 'That provider account is already connected to someone else here.'
    case 'access_denied':
      return 'Connecting was cancelled at the provider.'
    default:
      return `Connecting the provider did not work (${code}). Try again, or ask an admin.`
  }
}

/** A code from the address bar, only if it looks like one (it is shown on the page). */
export function errorCode(value: unknown): string | null {
  const code = Array.isArray(value) ? value[0] : value
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(code) ? code : null
}
