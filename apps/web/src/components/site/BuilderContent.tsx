import type { Config, Data } from '@puckeditor/core'
import { Render, resolveAllData } from '@puckeditor/core/rsc'
import React from 'react'

import { config } from '@/puck/config'
import { assignHeadingLevels } from '@/puck/data'
import type { CatalogParams, PetPageData } from '@/lib/queries'
import { petPageConfig } from '@/puck/pet-page-config'
import { buildSiteMetadata } from '@/puck/server'

// The typed config is widened here: saved JSON can't be checked against block types at compile time.
const looseConfig = config as unknown as Config
const loosePetConfig = petPageConfig as unknown as Config

// Renders saved Puck JSON on the server. Blocks that need live data (like the pet grid)
// are resolved here, so visitors get plain HTML with no editor code in the bundle.
//
// Heading structure: after the live data is in, the first heading on the page becomes its one
// <h1> and the rest follow from it (see assignHeadingLevels). A page with no headings at all gets a
// visually hidden <h1> with its `title`, so every page has exactly one.
export async function BuilderContent({
  data,
  title,
  searchParams,
  pet,
}: {
  data: Data
  title?: string
  /** The page's query string, for blocks that read it (the Pet catalogue's filters). */
  searchParams?: CatalogParams
  /** A pet's page: draws `data` (the Pet page template) with the pet blocks, for this pet. */
  pet?: PetPageData
}) {
  const metadata = await buildSiteMetadata(searchParams, pet)
  const blocks = pet ? loosePetConfig : looseConfig
  const resolved = await resolveAllData(data, blocks, metadata)
  const { data: leveled, hasH1 } = assignHeadingLevels(resolved)
  return (
    <>
      {!hasH1 && title ? <h1 className="sr-only">{title}</h1> : null}
      <Render config={blocks} data={leveled} metadata={metadata} />
    </>
  )
}
