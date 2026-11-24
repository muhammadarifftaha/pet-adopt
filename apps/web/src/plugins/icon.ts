import { isValidElement } from 'react'

import type { NavIcon, NavIconNode } from '@/components/admin/nav-items'

// Turns a plugin's icon (`nav.Icon` on a screen) into plain data (`NavIcon`) that can travel from the
// server, where the config runs, to the client sidebar. A component (a function) cannot cross that
// boundary, and react-icons cannot render on the server, so the icon is read once here and redrawn
// by the client.
//
// Two kinds are accepted, and nothing else:
//  - a react-icons icon, such as `FiStar` from "react-icons/fi";
//  - an SVG drawn from path data: `{ viewBox?, paths: string[], outline? }`. Only `d` strings are
//    taken, never markup, so an icon cannot carry a <script> or an `onload`.
// Tags and attributes are checked either way: a package that ships icons is still outside code.

export class IconError extends Error {}

const TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g'])
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-., \t\r\n]+$/
const VIEW_BOX = /^-?\d+(\.\d+)? -?\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?$/
const MAX_PATHS = 20
const MAX_PATH_LENGTH = 4000
const MAX_NODES = 100

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Attributes as strings. Anything that could run code or load something is refused. */
function cleanAttr(attr: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(attr)) {
    if (/^on/i.test(name) || /href$/i.test(name)) throw new IconError(`the attribute "${name}" is not allowed.`)
    if (name === 'style' || name === 'className' || name === 'children') continue
    if (typeof value === 'string' || typeof value === 'number') out[name] = String(value)
  }
  return out
}

function toNodes(children: unknown, count: { n: number }): NavIconNode[] {
  const list = Array.isArray(children) ? children.flat(Infinity) : children == null || children === false ? [] : [children]
  return list.map((child) => {
    if (!isValidElement(child) || typeof child.type !== 'string' || !TAGS.has(child.type)) {
      const found = isValidElement(child) ? `<${String(child.type)}>` : typeof child
      throw new IconError(`it contains ${found}; only ${[...TAGS].join(', ')} are allowed.`)
    }
    if (++count.n > MAX_NODES) throw new IconError(`it has more than ${MAX_NODES} shapes.`)
    const { children: inner, ...attr } = child.props as Record<string, unknown>
    return { tag: child.type, attr: cleanAttr(attr), child: toNodes(inner, count) }
  })
}

/** react-icons: `GenIcon` makes `(props) => <IconBase attr={svgAttributes}>{shapes}</IconBase>`. Calling it only builds that element (IconBase is not run), and the tree is read out of it. */
function fromReactIcon(icon: (props: object) => unknown): NavIcon {
  let element: unknown
  try {
    element = icon({})
  } catch {
    throw new IconError('calling it failed, so it is not a react-icons icon.')
  }
  const props = isValidElement(element) ? (element.props as { attr?: unknown; children?: unknown }) : null
  if (!props || !isRecord(props.attr)) throw new IconError('it is a function, but not a react-icons icon.')
  return { attr: cleanAttr(props.attr), child: toNodes(props.children, { n: 0 }) }
}

function fromSvg(icon: Record<string, unknown>): NavIcon {
  const { viewBox = '0 0 24 24', paths, outline } = icon
  if (typeof viewBox !== 'string' || !VIEW_BOX.test(viewBox)) throw new IconError('viewBox must look like "0 0 24 24".')
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PATHS) {
    throw new IconError(`paths must be a list of 1 to ${MAX_PATHS} path strings.`)
  }
  const child: NavIconNode[] = paths.map((d, i) => {
    if (typeof d !== 'string' || d.length > MAX_PATH_LENGTH || !PATH_DATA.test(d)) {
      throw new IconError(`paths[${i}] must be SVG path data (the "d" of a <path>, up to ${MAX_PATH_LENGTH} characters).`)
    }
    return { tag: 'path', attr: { d }, child: [] }
  })
  const attr: Record<string, string> =
    outline === true
      ? { viewBox, fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }
      : { viewBox, fill: 'currentColor' }
  return { attr, child }
}

/** Throws `IconError` (with the reason) for anything that is not a react-icons icon or a path-data SVG. */
export function toNavIcon(icon: unknown): NavIcon {
  if (typeof icon === 'function') return fromReactIcon(icon as (props: object) => unknown)
  if (isRecord(icon) && 'paths' in icon) return fromSvg(icon)
  throw new IconError('use a react-icons icon (for example FiStar from "react-icons/fi") or { viewBox, paths: ["M..."] }.')
}
