// Email templates: pure code shared by the email builder (client) and the sender (server).
//
// A template is Puck data (root + blocks) made only of the blocks below. Agreed with the owner:
//  - Each email the site sends has a purpose; the purpose decides the placeholders ({{name}}) a
//    template may use. Every purpose has a built-in default (DEFAULT_TEMPLATES), so an email never
//    depends on a template existing.
//  - A message to a visitor never contains what the visitor typed (no Details block): anyone can
//    enter any address in a public form, so echoing it would let strangers mail their own text.
//  - Templates are not tied to forms: any plugin sends them (host().sendTemplatedEmail) and fills
//    {{title}} and the Details block with its own content.
//
// Every block turns itself into email-safe HTML (tables and inline styles, plus one media query for
// stacking columns on phones; classic Outlook gets a fixed-width wrapper and bulletproof buttons) and
// into plain text. The builder's canvas shows that same HTML, so
// what is designed is what is sent. Stored data is rebuilt by `validateTemplate` from allowed
// blocks and props only, and everything a person typed is escaped when it is rendered.

export const EMAIL_PURPOSES = ['password-reset', 'invite', 'email-change', 'email-changed', 'test', 'team-notification', 'visitor-message'] as const
export type EmailPurpose = (typeof EMAIL_PURPOSES)[number]

/** Placeholders every template can use. */
export const COMMON_PLACEHOLDERS: Record<string, string> = { siteName: 'The site’s name', siteUrl: 'The site’s address' }

export const PURPOSE_INFO: Record<
  EmailPurpose,
  { label: string; description: string; placeholders: Record<string, string>; required: string[]; details: boolean; sample: Record<string, string> }
> = {
  'password-reset': {
    label: 'Password reset',
    description: 'Sent when someone asks for a reset link on the sign-in page.',
    placeholders: { name: 'The person’s name', resetLink: 'The one-time reset link (required)', minutes: 'How long the link works, in minutes' },
    required: ['resetLink'],
    details: false,
    sample: { name: 'Alex Rivera', resetLink: 'https://example.com/admin/reset-password?token=sample', minutes: '60' },
  },
  invite: {
    label: 'Invitation',
    description: 'Sent when an admin adds someone with “Email an invite”: they choose their own password.',
    placeholders: {
      name: 'The new person’s name',
      inviteLink: 'The one-time invite link (required)',
      inviterName: 'The admin who invited them',
      role: 'Their role, such as Editor',
      days: 'How long the link works, in days',
    },
    required: ['inviteLink'],
    details: false,
    sample: { name: 'Alex Rivera', inviteLink: 'https://example.com/admin/invite?token=sample', inviterName: 'Sam Lee', role: 'Editor', days: '7' },
  },
  'email-change': {
    label: 'Confirm new email',
    description: 'Sent to the new address when someone changes their email on the Account page. The change happens when they open its link.',
    placeholders: {
      name: 'The person’s name',
      confirmLink: 'The one-time confirmation link (required)',
      newEmail: 'The new address',
      hours: 'How long the link works, in hours',
    },
    required: ['confirmLink'],
    details: false,
    sample: { name: 'Alex Rivera', confirmLink: 'https://example.com/admin/confirm-email?token=sample', newEmail: 'alex@new.example', hours: '24' },
  },
  'email-changed': {
    label: 'Email change notice',
    description: 'Sent to the old address when someone asks to change their email, and to both addresses when an admin changes it.',
    placeholders: { name: 'The person’s name', oldEmail: 'The old address', newEmail: 'The new address', changedBy: 'Who asked for it: “you” or the admin’s name' },
    required: [],
    details: false,
    sample: { name: 'Alex Rivera', oldEmail: 'alex@old.example', newEmail: 'alex@new.example', changedBy: 'you' },
  },
  test: {
    label: 'Test email',
    description: 'Sent by “Send a test email” in Email > Sending.',
    placeholders: { senderName: 'Who sent the test' },
    required: [],
    details: false,
    sample: { senderName: 'Alex Rivera' },
  },
  'team-notification': {
    label: 'Team notification',
    description: 'Sent to your team when something comes in, such as a form response. Can list the details.',
    placeholders: { title: 'What it is about, such as the form’s name' },
    required: [],
    details: true,
    sample: { title: 'Adoption enquiry' },
  },
  'visitor-message': {
    label: 'Message to a visitor',
    description: 'Sent to someone outside the team, such as a confirmation after they fill in a form. Never repeats what they typed.',
    placeholders: { title: 'What it is about, such as the form’s name' },
    required: [],
    details: false,
    sample: { title: 'Adoption enquiry' },
  },
}

export const isEmailPurpose = (value: unknown): value is EmailPurpose => (EMAIL_PURPOSES as readonly unknown[]).includes(value)

/**
 * The site's own emails (agreed with the owner): no library of templates. The built-in template is
 * edited in place, and "Restore default" brings it back. Form emails keep a library instead,
 * so each form can pick its own.
 */
export const SYSTEM_PURPOSES = ['password-reset', 'invite', 'email-change', 'email-changed', 'test'] as const satisfies readonly EmailPurpose[]
export type SystemPurpose = (typeof SYSTEM_PURPOSES)[number]
export const isSystemPurpose = (value: unknown): value is SystemPurpose => (SYSTEM_PURPOSES as readonly unknown[]).includes(value)
export const LIBRARY_PURPOSES = EMAIL_PURPOSES.filter((purpose) => !isSystemPurpose(purpose))

/** The placeholders a purpose may use (its own plus the common ones). */
export function placeholdersFor(purpose: EmailPurpose): Record<string, string> {
  return { ...COMMON_PLACEHOLDERS, ...PURPOSE_INFO[purpose].placeholders }
}

// --- Template data ------------------------------------------------------------------------------

export type Align = 'left' | 'center' | 'right'
export type EmailImage = { id: number; url: string; alt: string }
export type BlockData =
  | { type: 'Heading'; props: { id: string; text: string; level: 'h1' | 'h2'; align: Align } }
  | { type: 'Text'; props: { id: string; text: string; align: Align; size: 'normal' | 'small' } }
  | { type: 'Button'; props: { id: string; label: string; url: string; align: Align; style: 'solid' | 'outline' } }
  | { type: 'Image'; props: { id: string; image: EmailImage | null; alt: string; width: 'full' | 'half'; align: Align; link: string } }
  | { type: 'Divider'; props: { id: string } }
  | { type: 'Spacer'; props: { id: string; size: 'small' | 'medium' | 'large' } }
  | { type: 'Columns'; props: { id: string; left: BlockData[]; right: BlockData[] } }
  | { type: 'Details'; props: { id: string; title: string } }

/** Where the site's name goes next to the logo (the email's logo): beside it or under it, either way round. */
export const LOGO_LAYOUTS = ['horizontal', 'horizontal-reverse', 'vertical', 'vertical-reverse'] as const
export type LogoLayout = (typeof LOGO_LAYOUTS)[number]

export type LogoSize = 'small' | 'medium' | 'large'
/**
 * The email's settings. The logo at the top is the site's logo from Site settings (or its name,
 * without one): size, alignment, a link to the site, and the site's name beside or under it.
 */
export type TemplateRoot = {
  subject: string
  preheader: string
  showLogo: boolean
  logoSize: LogoSize
  logoAlign: Align
  logoLink: boolean
  showSiteName: boolean
  logoLayout: LogoLayout
  footer: string
}
export type TemplateData = { root: { props: TemplateRoot }; content: BlockData[] }

export const TEMPLATE_LIMITS = { blocks: 60, text: 5000, heading: 200, label: 80, subject: 200, preheader: 200, footer: 1000, url: 2000, name: 80 }

const ALIGNS: readonly Align[] = ['left', 'center', 'right']
const PLACEHOLDER = /\{\{\s*([A-Za-z]+)\s*\}\}/g
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

// --- Validation (rebuilds the data from allowed parts) -----------------------------------------

export type TemplateCheck = { ok: true; data: TemplateData } | { ok: false; errors: string[] }

const str = (value: unknown, max: number): string | null => {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') return null
  const clean = value.replace(CONTROL, '').replace(/\r\n?/g, '\n')
  return clean.length > max ? null : clean
}
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options.includes(value as T) ? (value as T) : fallback)

/** One-time links an email may carry as a whole button or image link, when its purpose has them. */
export const LINK_PLACEHOLDERS = ['resetLink', 'inviteLink', 'confirmLink'] as const

/** The one-time link placeholders a purpose has ({{resetLink}}, {{inviteLink}}). */
export function linkPlaceholdersFor(purpose: EmailPurpose): string[] {
  const own = placeholdersFor(purpose)
  return LINK_PLACEHOLDERS.filter((name) => name in own)
}

/** A link a button or image may open: {{resetLink}} or {{inviteLink}}, {{siteUrl}} (with a path), a site path, or http(s). */
export function isAllowedEmailUrl(url: string, purpose: EmailPurpose): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  const only = /^\{\{\s*([A-Za-z]+)\s*\}\}(\/[^\s"'<>\\]*)?$/.exec(trimmed)
  if (only) {
    if (only[1] === 'siteUrl') return true
    return linkPlaceholdersFor(purpose).includes(only[1]) && only[2] === undefined
  }
  if (/\{\{/.test(trimmed)) return false
  if (/^\/(?!\/)[^\s"'<>\\]*$/.test(trimmed)) return true
  try {
    const parsed = new URL(trimmed)
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password
  } catch {
    return false
  }
}

const placeholdersIn = (text: string) => [...text.matchAll(PLACEHOLDER)].map((match) => match[1])

/**
 * Checks a template for a purpose and returns a clean copy built from the allowed blocks and props.
 * Unknown blocks, nested columns, a Details block where details are not allowed, unknown
 * placeholders, bad links and a missing required placeholder are errors.
 */
export function validateTemplate(raw: unknown, purpose: EmailPurpose): TemplateCheck {
  const errors: string[] = []
  const allowed = placeholdersFor(purpose)
  const used = new Set<string>()
  const data = raw && typeof raw === 'object' ? (raw as { root?: { props?: Record<string, unknown> }; content?: unknown }) : {}
  const rootProps = data.root?.props ?? {}
  let count = 0

  const checkText = (where: string, value: unknown, max: number): string => {
    const text = str(value, max)
    if (text === null) {
      errors.push(`${where}: use at most ${max} characters.`)
      return ''
    }
    for (const name of placeholdersIn(text)) {
      if (name in allowed) used.add(name)
      else errors.push(`${where}: {{${name}}} is not available in this kind of email.`)
    }
    return text
  }

  const blocks = (list: unknown, where: string, nested: boolean): BlockData[] => {
    if (list === undefined || list === null) return []
    if (!Array.isArray(list)) {
      errors.push(`${where}: not a list of blocks.`)
      return []
    }
    const out: BlockData[] = []
    for (const [index, item] of list.entries()) {
      count++
      if (count > TEMPLATE_LIMITS.blocks) {
        errors.push(`Use at most ${TEMPLATE_LIMITS.blocks} blocks.`)
        return out
      }
      const block = item && typeof item === 'object' ? (item as { type?: unknown; props?: Record<string, unknown> }) : {}
      const props = block.props ?? {}
      const id = typeof props.id === 'string' && /^[\w-]{1,80}$/.test(props.id) ? props.id : `block-${count}`
      const at = `${where} block ${index + 1}${typeof block.type === 'string' ? ` (${block.type})` : ''}`
      switch (block.type) {
        case 'Heading':
          out.push({
            type: 'Heading',
            props: { id, text: checkText(at, props.text, TEMPLATE_LIMITS.heading), level: oneOf(props.level, ['h1', 'h2'] as const, 'h2'), align: oneOf(props.align, ALIGNS, 'left') },
          })
          break
        case 'Text':
          out.push({
            type: 'Text',
            props: { id, text: checkText(at, props.text, TEMPLATE_LIMITS.text), align: oneOf(props.align, ALIGNS, 'left'), size: oneOf(props.size, ['normal', 'small'] as const, 'normal') },
          })
          break
        case 'Button': {
          const label = checkText(at, props.label, TEMPLATE_LIMITS.label)
          const url = (str(props.url, TEMPLATE_LIMITS.url) ?? '').trim()
          if (!label.trim()) errors.push(`${at}: add the button’s text.`)
          if (!url) errors.push(`${at}: add the link the button opens.`)
          else if (!isAllowedEmailUrl(url, purpose)) errors.push(`${at}: the link must be a web address (https://…), a path on this site (/…), {{siteUrl}}${linkPlaceholdersFor(purpose).map((name) => ` or {{${name}}}`).join('')}.`)
          else for (const name of placeholdersIn(url)) used.add(name)
          out.push({ type: 'Button', props: { id, label, url, align: oneOf(props.align, ALIGNS, 'left'), style: oneOf(props.style, ['solid', 'outline'] as const, 'solid') } })
          break
        }
        case 'Image': {
          const image = props.image && typeof props.image === 'object' ? (props.image as { id?: unknown; url?: unknown; alt?: unknown }) : null
          const imageId = Number(image?.id)
          const imageUrl = typeof image?.url === 'string' ? image.url : ''
          const clean: EmailImage | null =
            image && Number.isSafeInteger(imageId) && imageId > 0 && /^\/media\/[\w.-]{1,200}$/.test(imageUrl)
              ? { id: imageId, url: imageUrl, alt: (str(image.alt, 300) ?? '').trim() }
              : null
          if (image && !clean) errors.push(`${at}: choose the image from the media library.`)
          const link = (str(props.link, TEMPLATE_LIMITS.url) ?? '').trim()
          if (link && !isAllowedEmailUrl(link, purpose)) errors.push(`${at}: the image link must be a web address, a path on this site or {{siteUrl}}.`)
          out.push({
            type: 'Image',
            props: { id, image: clean, alt: checkText(at, props.alt, 300), width: oneOf(props.width, ['full', 'half'] as const, 'full'), align: oneOf(props.align, ALIGNS, 'center'), link },
          })
          break
        }
        case 'Divider':
          out.push({ type: 'Divider', props: { id } })
          break
        case 'Spacer':
          out.push({ type: 'Spacer', props: { id, size: oneOf(props.size, ['small', 'medium', 'large'] as const, 'medium') } })
          break
        case 'Columns':
          if (nested) {
            errors.push(`${at}: columns cannot go inside columns.`)
            break
          }
          out.push({ type: 'Columns', props: { id, left: blocks(props.left, `${at}, left column,`, true), right: blocks(props.right, `${at}, right column,`, true) } })
          break
        case 'Details':
          if (!PURPOSE_INFO[purpose].details) {
            errors.push(`${at}: the details can only go in “${PURPOSE_INFO['team-notification'].label}” emails.`)
            break
          }
          out.push({ type: 'Details', props: { id, title: checkText(at, props.title, TEMPLATE_LIMITS.heading) } })
          break
        default:
          errors.push(`${at}: this kind of block cannot be used in an email.`)
      }
    }
    return out
  }

  const content = blocks(data.content, 'The email’s', false)
  const subject = checkText('Subject', rootProps.subject, TEMPLATE_LIMITS.subject).replace(/\s+/g, ' ').trim()
  if (!subject) errors.push('Subject: add a subject line.')
  const root: TemplateRoot = {
    subject,
    preheader: checkText('Preview text', rootProps.preheader, TEMPLATE_LIMITS.preheader).replace(/\s+/g, ' ').trim(),
    showLogo: rootProps.showLogo !== false,
    // Missing values keep the look templates had before these options: medium, centred, no link, no name.
    logoSize: oneOf(rootProps.logoSize, ['small', 'medium', 'large'] as const, 'medium'),
    logoAlign: oneOf(rootProps.logoAlign, ALIGNS, 'center'),
    logoLink: rootProps.logoLink === true,
    showSiteName: rootProps.showSiteName === true,
    logoLayout: oneOf(rootProps.logoLayout, LOGO_LAYOUTS, 'horizontal'),
    footer: checkText('Footer', rootProps.footer, TEMPLATE_LIMITS.footer),
  }
  if (!content.length) errors.push('Add at least one block.')
  for (const name of PURPOSE_INFO[purpose].required) {
    if (!used.has(name)) errors.push(`This email must include {{${name}}}, for example as a button’s link.`)
  }
  return errors.length ? { ok: false, errors: [...new Set(errors)] } : { ok: true, data: { root: { props: root }, content } }
}

// --- Rendering ----------------------------------------------------------------------------------

export type EmailTheme = { primary: string; onPrimary: string; ink: string; muted: string; background: string; surface: string; line: string; font: string; headingFont: string; radius: number }

export type RenderContext = {
  /** Placeholder values. Missing ones render as nothing (the builder shows them as {{name}} instead). */
  values: Record<string, string>
  /** For the Details block (team notifications only): label and value pairs, such as a form's answers. */
  details?: Array<{ label: string; value: string }>
  theme: EmailTheme
  /** The site's address (no trailing slash): makes /media/… and /paths absolute. */
  origin: string
  logo: { url: string; alt: string } | null
  /** In the builder: show placeholders as {{name}} chips instead of values. */
  showPlaceholders?: boolean
}

/**
 * An image's address in an email: absolute, and a WebP upload as its PNG copy (/media/email/…),
 * because classic Outlook and some older clients cannot show WebP. The builder's canvas (a browser)
 * keeps the original.
 */
export function emailImageSrc(url: string, ctx: RenderContext): string {
  const webp = /^\/media\/([a-z0-9][a-z0-9-]*)\.webp$/.exec(url)
  const path = webp && !ctx.showPlaceholders ? `/media/email/${webp[1]}.png` : url
  return path.startsWith('/') ? `${ctx.origin}${path}` : path
}

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

const safeColor = (value: string, fallback: string) => (/^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback)
const safeFont = (value: string) => value.replace(/[^\w\s,'-]/g, '')

/** Text with placeholders filled, as escaped HTML. */
function fill(text: string, ctx: RenderContext): string {
  let out = ''
  let last = 0
  for (const match of text.matchAll(PLACEHOLDER)) {
    out += escapeHtml(text.slice(last, match.index))
    const name = match[1]
    out += ctx.showPlaceholders
      ? `<span style="background:#eef2ff;color:#3730a3;border-radius:4px;padding:0 3px;font-family:monospace;font-size:0.9em">{{${escapeHtml(name)}}}</span>`
      : escapeHtml(ctx.values[name] ?? '')
    last = (match.index ?? 0) + match[0].length
  }
  return out + escapeHtml(text.slice(last))
}

/** Text with placeholders filled, as plain text. */
function fillText(text: string, ctx: RenderContext): string {
  return text.replace(PLACEHOLDER, (_, name: string) => (ctx.showPlaceholders ? `{{${name}}}` : (ctx.values[name] ?? '')))
}

/** A link with placeholders filled and site paths made absolute. Never anything but http(s). */
function fillUrl(url: string, ctx: RenderContext): string {
  const filled = fillText(url, { ...ctx, showPlaceholders: false }).trim()
  const absolute = filled.startsWith('/') && !filled.startsWith('//') ? `${ctx.origin}${filled}` : filled
  return /^https?:\/\//i.test(absolute) ? absolute : '#'
}

const paragraphs = (html: string) =>
  html
    .split(/\n{2,}/)
    .map((part) => part.trim().replace(/\n/g, '<br>'))
    .filter(Boolean)

const SPACER = { small: 12, medium: 24, large: 40 }

/** One block as email HTML (inside the content cell). */
export function blockHtml(block: BlockData, ctx: RenderContext): string {
  const t = ctx.theme
  const font = `font-family:${safeFont(t.font)};`
  switch (block.type) {
    case 'Heading': {
      const size = block.props.level === 'h1' ? 26 : 20
      return `<${block.props.level} style="margin:0 0 16px;font-family:${safeFont(t.headingFont)};font-size:${size}px;line-height:1.3;font-weight:700;color:${t.ink};text-align:${block.props.align}">${fill(block.props.text, ctx)}</${block.props.level}>`
    }
    case 'Text': {
      const size = block.props.size === 'small' ? 13 : 16
      const color = block.props.size === 'small' ? t.muted : t.ink
      return paragraphs(fill(block.props.text, ctx))
        .map((part) => `<p style="margin:0 0 16px;${font}font-size:${size}px;line-height:1.6;color:${color};text-align:${block.props.align}">${part}</p>`)
        .join('')
    }
    case 'Button': {
      // A "bulletproof" button: the colour and padding sit on a table cell, which every client draws;
      // classic Outlook (Word's engine) ignores padding on links, so it gets `mso-padding-alt` and
      // `bgcolor` on the cell. Other clients use the link's own padding, so all of it is clickable.
      const solid = block.props.style === 'solid'
      const href = ctx.showPlaceholders ? '#' : escapeHtml(fillUrl(block.props.url, ctx))
      const color = solid ? t.onPrimary : t.primary
      const cellColor = solid ? ` bgcolor="${t.primary}"` : ''
      const tableAlign = block.props.align === 'center' ? 'center' : block.props.align
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${tableAlign}" style="margin:0 0 16px${block.props.align === 'center' ? ';margin-left:auto;margin-right:auto' : ''}"><tr><td align="center"${cellColor} style="border-radius:${t.radius}px;background:${solid ? t.primary : 'transparent'};border:2px solid ${t.primary};mso-padding-alt:12px 22px"><a href="${href}" target="_blank" style="display:inline-block;padding:12px 22px;${font}font-size:16px;font-weight:700;line-height:1.2;color:${color};text-decoration:none;border-radius:${t.radius}px">${fill(block.props.label, ctx)}</a></td></tr></table><div style="clear:both;height:0;line-height:0;font-size:0">&nbsp;</div>`
    }
    case 'Image': {
      const image = block.props.image
      if (!image) return ctx.showPlaceholders ? `<p style="margin:0 0 16px;${font}color:${t.muted};text-align:center;border:1px dashed ${t.line};padding:24px">Choose an image</p>` : ''
      const width = block.props.width === 'half' ? 268 : 536
      const alt = fill(block.props.alt || image.alt, { ...ctx, showPlaceholders: false })
      const img = `<img src="${escapeHtml(emailImageSrc(image.url, ctx))}" width="${width}" alt="${alt}" style="display:inline-block;width:100%;max-width:${width}px;height:auto;border:0;text-decoration:none;border-radius:${t.radius}px">`
      const linked = block.props.link && !ctx.showPlaceholders ? `<a href="${escapeHtml(fillUrl(block.props.link, ctx))}" target="_blank">${img}</a>` : img
      return `<div style="margin:0 0 16px;text-align:${block.props.align}">${linked}</div>`
    }
    case 'Divider':
      return `<div style="margin:8px 0 24px;border-top:1px solid ${t.line};line-height:0;font-size:0">&nbsp;</div>`
    case 'Spacer':
      return `<div style="height:${SPACER[block.props.size]}px;line-height:${SPACER[block.props.size]}px;font-size:0">&nbsp;</div>`
    case 'Columns':
      return columnsHtml(block.props.left.map((child) => blockHtml(child, ctx)).join(''), block.props.right.map((child) => blockHtml(child, ctx)).join(''))
    case 'Details': {
      const details =
        ctx.details ??
        (ctx.showPlaceholders
          ? [
              { label: 'Your name', value: 'Sample answer' },
              { label: 'Message', value: 'Each detail, such as a form’s answers, appears here.' },
            ]
          : [])
      const title = block.props.title ? `<p style="margin:0 0 8px;${font}font-size:16px;font-weight:700;color:${t.ink}">${fill(block.props.title, ctx)}</p>` : ''
      const rows = details
        .map(
          (detail) =>
            `<tr><td valign="top" style="padding:8px 12px 8px 0;border-top:1px solid ${t.line};${font}font-size:14px;font-weight:700;color:${t.ink};width:35%">${escapeHtml(detail.label)}</td><td valign="top" style="padding:8px 0;border-top:1px solid ${t.line};${font}font-size:14px;color:${t.ink}">${escapeHtml(detail.value || '(blank)').replace(/\n/g, '<br>')}</td></tr>`,
        )
        .join('')
      return `${title}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">${rows}</table>`
    }
  }
}

/** Two columns (stacked on phones by the layout's media query). Both cells are already HTML. */
export function columnsHtml(left: string, right: string): string {
  return `<table role="presentation" class="pa-columns" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px"><tr><td class="pa-column" width="50%" valign="top" style="padding-right:12px">${left}</td><td class="pa-column" width="50%" valign="top" style="padding-left:12px">${right}</td></tr></table>`
}

/** One block as plain text. */
export function blockText(block: BlockData, ctx: RenderContext): string {
  switch (block.type) {
    case 'Heading':
      return fillText(block.props.text, ctx).toUpperCase()
    case 'Text':
      return fillText(block.props.text, ctx).trim()
    case 'Button':
      return `${fillText(block.props.label, ctx)}: ${fillUrl(block.props.url, ctx)}`
    case 'Image':
      return block.props.image && block.props.alt ? `[${fillText(block.props.alt, ctx)}]` : ''
    case 'Divider':
      return '----'
    case 'Spacer':
      return ''
    case 'Columns':
      return [...block.props.left, ...block.props.right]
        .map((child) => blockText(child, ctx))
        .filter(Boolean)
        .join('\n\n')
    case 'Details': {
      const lines = (ctx.details ?? []).map((detail) => `${detail.label}: ${detail.value || '(blank)'}`)
      return [block.props.title ? fillText(block.props.title, ctx) : '', ...lines].filter(Boolean).join('\n')
    }
  }
}

/** The logo row's HTML (or the site's name), shared by the email and the builder's canvas. */
export function logoHtml(root: TemplateRoot, ctx: RenderContext): string {
  if (!root.showLogo) return ''
  const { logoSize, logoAlign: align, logoLink, showSiteName, logoLayout: layout } = root
  const height = LOGO_HEIGHT[logoSize]
  const link = (html: string) => (logoLink && !ctx.showPlaceholders ? `<a href="${escapeHtml(ctx.origin)}" target="_blank" style="text-decoration:none">${html}</a>` : html)
  // Without a logo, or without the name: one mark. Otherwise a small table (classic Outlook keeps it).
  if (!ctx.logo || !showSiteName) return link(brandHtml(ctx, height))
  const logo = link(logoImgHtml(ctx.logo, ctx, height))
  const name = link(siteNameHtml(ctx, height))
  const [first, second] = layout.endsWith('reverse') ? [name, logo] : [logo, name]
  const center = align === 'center' ? ';margin-left:auto;margin-right:auto' : ''
  const rows = layout.startsWith('horizontal')
    ? `<tr><td valign="middle" style="padding-right:12px">${first}</td><td valign="middle">${second}</td></tr>`
    : `<tr><td align="${align}" style="padding-bottom:8px">${first}</td></tr><tr><td align="${align}">${second}</td></tr>`
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="margin:0${center}">${rows}</table>`
}

/** Logo heights (px) for the email's logo: small, medium (the default), large. */
const LOGO_HEIGHT = { small: 32, medium: 48, large: 64 } as const

/** The site's logo at `height` px, or its name in the heading font when it has no logo. */
function brandHtml(ctx: RenderContext, height: number): string {
  return ctx.logo ? logoImgHtml(ctx.logo, ctx, height) : siteNameHtml(ctx, height)
}

function logoImgHtml(logo: NonNullable<RenderContext['logo']>, ctx: RenderContext, height: number): string {
  return `<img src="${escapeHtml(emailImageSrc(logo.url, ctx))}" alt="${escapeHtml(logo.alt || ctx.values.siteName || '')}" height="${height}" style="display:inline-block;height:${height}px;width:auto;border:0;vertical-align:middle">`
}

/** The site's name in the heading font, sized to sit with a logo `height` px tall. */
function siteNameHtml(ctx: RenderContext, height: number): string {
  const t = ctx.theme
  return `<span style="font-family:${safeFont(t.headingFont)};font-size:${Math.round(height * 0.42)}px;line-height:1.2;font-weight:700;color:${t.ink}">${escapeHtml(ctx.values.siteName ?? '')}</span>`
}

/** The footer's HTML, shared by the email and the builder's canvas. */
export function footerHtml(root: TemplateRoot, ctx: RenderContext): string {
  const t = ctx.theme
  return paragraphs(fill(root.footer, ctx))
    .map((part) => `<p style="margin:0 0 8px;font-family:${safeFont(t.font)};font-size:12px;line-height:1.5;color:${t.muted};text-align:center">${part}</p>`)
    .join('')
}

/** The whole email around the blocks: background, a 600 px card, the logo and the footer. */
export function layoutHtml(inner: string, root: TemplateRoot, ctx: RenderContext, subject: string): string {
  const t = ctx.theme
  const logo = logoHtml(root, ctx)
  const footer = footerHtml(root, ctx)
  // The preview text most inboxes show after the subject; hidden in the email itself.
  const preheader = root.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${fill(root.preheader, { ...ctx, showPlaceholders: false })}</div>` : ''
  // Classic Outlook (Word's engine): the conditional comments give it a fixed 600 px table (it ignores
  // max-width) and 96 DPI, so images are not rescaled; `bgcolor` attributes for its backgrounds.
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(subject)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>@media (max-width: 600px) { .pa-columns .pa-column { display: block !important; width: 100% !important; padding: 0 !important; } }</style></head>
<body bgcolor="${t.background}" style="margin:0;padding:0;background:${t.background}">${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.background}" style="background:${t.background}"><tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.surface}" style="width:100%;max-width:600px;background:${t.surface};border-radius:${t.radius}px;border:1px solid ${t.line}">
${logo ? `<tr><td align="${root.logoAlign}" style="padding:28px 32px 0">${logo}</td></tr>` : ''}<tr><td style="padding:28px 32px 12px;font-family:${safeFont(t.font)};color:${t.ink}">${inner}</td></tr>${footer ? `<tr><td style="padding:0 32px 28px">${footer}</td></tr>` : ''}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`
}

export type RenderedEmail = { subject: string; html: string; text: string }

/** A whole email from (validated) template data. */
export function renderEmail(data: TemplateData, ctx: RenderContext): RenderedEmail {
  const root = data.root.props
  const subject = fillText(root.subject, ctx).replace(/\s+/g, ' ').trim()
  const html = layoutHtml(data.content.map((block) => blockHtml(block, ctx)).join(''), root, ctx, subject)
  const text = [...data.content.map((block) => blockText(block, ctx)), root.footer ? `--\n${fillText(root.footer, ctx)}` : '']
    .filter((part) => part.trim())
    .join('\n\n')
  return { subject, html, text }
}

/** Colours and fonts for emails from the site's resolved light theme variables. */
export function emailThemeFrom(light: Record<string, string>, shared: Record<string, string>): EmailTheme {
  const fallbackFont = 'Helvetica, Arial, sans-serif'
  return {
    primary: safeColor(light['--primary'] ?? '', '#e8590c'),
    onPrimary: safeColor(light['--on-primary'] ?? '', '#ffffff'),
    ink: safeColor(light['--ink'] ?? '', '#1f2937'),
    muted: safeColor(light['--muted'] ?? '', '#6b7077'),
    background: safeColor(light['--surface-alt'] ?? light['--bg'] ?? '', '#f4f4f5'),
    surface: safeColor(light['--surface'] ?? '', '#ffffff'),
    line: safeColor(light['--line'] ?? '', '#e5e7eb'),
    // Web fonts rarely load in email: the theme's font first, then safe system fonts.
    font: [shared['--font-body'], fallbackFont].filter(Boolean).join(', '),
    headingFont: [shared['--font-heading'], fallbackFont].filter(Boolean).join(', '),
    radius: Math.min(Math.max(Number.parseInt(shared['--radius-btn'] ?? shared['--radius'] ?? '8', 10) || 0, 0), 24),
  }
}

// --- Built-in templates ---------------------------------------------------------------------------

const heading = (id: string, text: string): BlockData => ({ type: 'Heading', props: { id, text, level: 'h1', align: 'left' } })
const text = (id: string, value: string, size: 'normal' | 'small' = 'normal'): BlockData => ({ type: 'Text', props: { id, text: value, align: 'left', size } })
const button = (id: string, label: string, url: string): BlockData => ({ type: 'Button', props: { id, label, url, align: 'left', style: 'solid' } })

const FOOTER = 'Sent by {{siteName}} · {{siteUrl}}'
/** The logo as templates have always had it: shown, medium, centred, no link, no name. */
export const LOGO_DEFAULTS = { showLogo: true, logoSize: 'medium', logoAlign: 'center', logoLink: false, showSiteName: false, logoLayout: 'horizontal' } as const

/** What each purpose sends when no template of that purpose is marked as the default. */
export const DEFAULT_TEMPLATES: Record<EmailPurpose, TemplateData> = {
  'password-reset': {
    root: { props: { subject: 'Reset your {{siteName}} password', preheader: 'Choose a new password within {{minutes}} minutes.', ...LOGO_DEFAULTS, footer: FOOTER } },
    content: [
      heading('heading-1', 'Reset your password'),
      text('text-1', 'Hello {{name}},\n\nSomeone asked to reset the password of your {{siteName}} account. To choose a new one, use this link within {{minutes}} minutes:'),
      button('button-1', 'Choose a new password', '{{resetLink}}'),
      text('text-2', 'The link works once. If you did not ask for this, ignore this email: your password stays the same.', 'small'),
    ],
  },
  invite: {
    root: { props: { subject: 'You’re invited to {{siteName}}', preheader: '{{inviterName}} added you as {{role}}. Choose your password within {{days}} days.', ...LOGO_DEFAULTS, footer: FOOTER } },
    content: [
      heading('heading-1', 'Welcome to {{siteName}}'),
      text('text-1', 'Hello {{name}},\n\n{{inviterName}} added you to the {{siteName}} admin as {{role}}. To start, choose your password with this link within {{days}} days:'),
      button('button-1', 'Choose your password', '{{inviteLink}}'),
      text('text-2', 'The link works once. If you were not expecting this, you can ignore this email.', 'small'),
    ],
  },
  'email-change': {
    root: { props: { subject: 'Confirm your new email for {{siteName}}', preheader: 'Confirm {{newEmail}} within {{hours}} hours.', ...LOGO_DEFAULTS, footer: FOOTER } },
    content: [
      heading('heading-1', 'Confirm your new email'),
      text('text-1', 'Hello {{name}},\n\nYou asked to sign in to {{siteName}} with {{newEmail}} from now on. To confirm it, use this link within {{hours}} hours:'),
      button('button-1', 'Confirm my new email', '{{confirmLink}}'),
      text('text-2', 'Until you confirm, your old email keeps working. If you did not ask for this, ignore this email.', 'small'),
    ],
  },
  'email-changed': {
    root: { props: { subject: 'Your {{siteName}} sign-in email is changing', preheader: 'From {{oldEmail}} to {{newEmail}}.', ...LOGO_DEFAULTS, footer: FOOTER } },
    content: [
      heading('heading-1', 'Your sign-in email is changing'),
      text('text-1', 'Hello {{name}},\n\nA change of the email you sign in to {{siteName}} with, from {{oldEmail}} to {{newEmail}}, was asked for by {{changedBy}}.'),
      text('text-2', 'If you did not expect this, contact an admin of {{siteName}} straight away and change your password.', 'small'),
    ],
  },
  test: {
    root: { props: { subject: 'Test email from {{siteName}}', preheader: 'The site can send email.', ...LOGO_DEFAULTS, footer: FOOTER } },
    content: [
      heading('heading-1', 'It works'),
      text('text-1', 'This is a test email from {{siteName}}, sent by {{senderName}} from the admin. If you can read it, the site can send email, for example password reset links.'),
    ],
  },
  'team-notification': {
    root: { props: { subject: 'New: {{title}}', preheader: 'Something new on {{siteName}}: {{title}}.', ...LOGO_DEFAULTS, footer: FOOTER } },
    content: [
      heading('heading-1', 'New: {{title}}'),
      text('text-1', 'Something new came in on {{siteName}}. The details:'),
      { type: 'Details', props: { id: 'details-1', title: '' } },
    ],
  },
  'visitor-message': {
    root: { props: { subject: 'Thanks, we got your message', preheader: 'We received your {{title}}.', ...LOGO_DEFAULTS, footer: FOOTER } },
    content: [heading('heading-1', 'Thank you'), text('text-1', 'We received your “{{title}}” and will get back to you soon.\n\n{{siteName}}')],
  },
}
