import type { Config, Data } from '@puckeditor/core'
import { Render, resolveAllData } from '@puckeditor/core/rsc'
import React from 'react'

import { config } from '@/puck/config'
import { assignHeadingLevels } from '@/puck/data'
import { buildSiteMetadata } from '@/puck/server'

// The typed config is widened here: saved JSON can't be checked against block types at compile time.
const looseConfig = config as unknown as Config

// Renders saved Puck JSON on the server. Blocks that need live data (like the pet grid)
// are resolved here, so visitors get plain HTML with no editor code in the bundle.
//
// Heading structure: after the live data is in, the first heading on the page becomes its one
// <h1> and the rest follow from it (see assignHeadingLevels). A page with no headings at all gets a
// visually hidden <h1> with its `title`, so every page has exactly one.
export async function BuilderContent({ data, title }: { data: Data; title?: string }) {
  const metadata = await buildSiteMetadata()
  const resolved = await resolveAllData(data, looseConfig, metadata)
  const { data: leveled, hasH1 } = assignHeadingLevels(resolved)
  return (
    <>
      {!hasH1 && title ? <h1 className="sr-only">{title}</h1> : null}
      <Render config={looseConfig} data={leveled} metadata={metadata} />
    </>
  )
}
