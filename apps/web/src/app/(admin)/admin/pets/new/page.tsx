import { headers } from 'next/headers'

import { PageHeader } from '@/components/admin/PageHeader'
import { requirePermissionPage } from '@/lib/admin/unwrap'
import { getSettings } from '@/server/settings'

import { PetForm } from '../PetForm'

export const metadata = { title: 'Add pet' }

export default async function NewPetPage() {
  // Reading the request first keeps this page from being prerendered at build time, when the
  // database may not exist (see "Build without a DB" in CLAUDE.md).
  await headers()
  await requirePermissionPage('pets:edit')
  const { siteName } = await getSettings()

  return (
    <>
      <PageHeader title="Add pet" />
      <PetForm pet={null} siteName={siteName} />
    </>
  )
}
