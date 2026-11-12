import type { Config, Data } from '@puckeditor/core'
import { Render, resolveAllData } from '@puckeditor/core/rsc'
import React from 'react'

import { config } from '@/puck/config'
import { buildSiteMetadata } from '@/puck/server'

// The typed config is widened here: saved JSON can't be checked against block types at compile time.
const looseConfig = config as unknown as Config

// Renders saved Puck JSON on the server. Blocks that need live data (like the pet grid)
// are resolved here, so visitors get plain HTML with no editor code in the bundle.
export async function BuilderContent({ data }: { data: Data }) {
  const metadata = await buildSiteMetadata()
  const resolved = await resolveAllData(data, looseConfig, metadata)
  return <Render config={looseConfig} data={resolved} metadata={metadata} />
}
