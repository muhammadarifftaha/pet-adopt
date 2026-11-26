// The site's privacy policy (agreed with the owner): one of the owners' own pages, chosen in Site
// settings > Navigation (`site_settings.privacy_page_id`). While that page is live (published and not
// archived), the footer and every form link to it, and the form builder stops warning that forms
// collect personal data without one.
import { and, eq, isNull } from 'drizzle-orm'

import { getDatabase } from '@/db/client'

export type PrivacyPolicy = { id: number; title: string; href: string }

/** The live privacy policy page, or null when none is chosen or it is not live. */
export async function getPrivacyPolicy(): Promise<PrivacyPolicy | null> {
  const { db, t } = await getDatabase()
  const [row] = await db
    .select({ id: t.pages.id, title: t.pages.title, slug: t.pages.slug })
    .from(t.siteSettings)
    .innerJoin(t.pages, eq(t.pages.id, t.siteSettings.privacyPageId))
    .where(and(eq(t.siteSettings.id, 1), eq(t.pages.status, 'published'), isNull(t.pages.archivedAt)))
    .limit(1)
  return row ? { id: row.id, title: row.title, href: `/${row.slug}` } : null
}
