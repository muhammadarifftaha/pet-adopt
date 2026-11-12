import React from 'react'

import { BuilderContent } from '@/components/site/BuilderContent'
import { getPublishedPage } from '@/lib/queries'
import { DEFAULT_HOME_DATA, isPuckData } from '@/puck/data'

// Cached, and refreshed immediately when a page or pet is saved (see the collection hooks).
export const revalidate = 60

export default async function HomePage() {
  const page = await getPublishedPage('home')
  const data = page && isPuckData(page.puckData) ? page.puckData : DEFAULT_HOME_DATA
  return <BuilderContent data={data} />
}
