// Socket and nodemailer error codes, worded for the person fixing the email settings.
const BY_CODE: Record<string, string> = {
  EAUTH: 'The mail server refused the user name or password.',
  ENOAUTH: 'The mail server asks for a user name and password.',
  ETLS: 'The secure connection failed. Check the security setting (TLS is usually port 465, STARTTLS 587).',
  EDNS: "The mail server's name could not be found. Check the host.",
  ENOTFOUND: "The mail server's name could not be found. Check the host.",
  EAI_AGAIN: "The mail server's name could not be found. Check the host.",
  ETIMEDOUT: 'The mail server did not answer in time. Check the host, port and security.',
  ECONNECTION: 'Could not connect to the mail server. Check the host, port and security.',
  ESOCKET: 'Could not connect to the mail server. Check the host, port and security.',
  ECONNREFUSED: 'The mail server refused the connection. Check the host and port.',
  ECONNRESET: 'The mail server closed the connection. Check the port and security.',
  EHOSTUNREACH: 'The mail server could not be reached. Check the host.',
  ENETUNREACH: 'The mail server could not be reached. Check the host.',
}

const GENERIC = 'Something went wrong while sending. The server log has the details.'

/**
 * Why a send failed, safe to show whoever has `settings:edit`: the mail server's own reply, a plain
 * reason for a connection problem, or the message of an error without a code (the site's own, or
 * an email plugin's). Never a database error, nor a socket error's text, which names the server's
 * address (the host may come from SMTP_HOST, set by whoever runs the server). Log the error itself
 * with `logError`.
 */
export function sendFailureReason(error: unknown): string {
  if (!(error instanceof Error)) return GENERIC
  const { code, response } = error as { code?: unknown; response?: unknown }
  // The SMTP server's reply ("535 5.7.8 Authentication failed").
  if (typeof response === 'string' && /^\d{3}\b/.test(response)) return `The mail server answered: ${response.split('\n')[0].slice(0, 200)}`
  if (typeof code === 'string') {
    if (/certificate|altnames|self[- ]signed/i.test(error.message)) return "The mail server's certificate is not valid for its name, or is not trusted."
    return BY_CODE[code] ?? GENERIC
  }
  if (error.name.includes('Drizzle') || /^Failed query/.test(error.message)) return GENERIC
  return error.message.split('\n')[0].slice(0, 300) || GENERIC
}
