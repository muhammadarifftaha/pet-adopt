// One page as Markdown, for AI agents and "Copy Markdown": `/docs/plugins/blocks.md` (and `.txt`)
// are rewritten here by next.config.mjs, and `/docs/...` asked for with `Accept: text/markdown` by
// the proxy. The path is `docs/<slugs>.md`; the docs index arrives as `docs.md`.
import { docsLlms, source } from '@/lib/source'

export const revalidate = false
// other paths are 404s, never cached responses
export const dynamicParams = false

function slugsOf(path: string[]): string[] | null {
  const [root, ...slugs] = path.join('/').replace(/\.(md|txt)$/, '').split('/')
  return root === 'docs' ? slugs : null
}

export async function GET(_req: Request, { params }: RouteContext<'/llms.mdx/[...path]'>) {
  const slugs = slugsOf((await params).path)
  const page = slugs && source.getPage(slugs)
  if (!page) return new Response(null, { status: 404 })
  return new Response(await docsLlms.page(page), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}

export function generateStaticParams() {
  return source.getPages().flatMap((page) => {
    const last = page.slugs.length ? ['docs', ...page.slugs] : ['docs']
    const md = [...last.slice(0, -1), `${last.at(-1)}.md`]
    const txt = [...last.slice(0, -1), `${last.at(-1)}.txt`]
    return [{ path: md }, { path: txt }]
  })
}
