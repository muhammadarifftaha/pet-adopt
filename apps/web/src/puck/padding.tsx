// Padding above and below every block (agreed with the owner): one "Padding" option (Top, Bottom)
// added to every block of a config by `withPadding`, instead of in each block. A block draws as
// before inside a wrapper whose data attributes override the padding of the block's outer element
// (styles.css, `.block-pad`), so it works for every block whatever its markup.
//
// "Default" (or nothing saved) keeps the block's own padding, so older pages never change. Blocks
// with the older single "Spacing" option lose that field: its saved value is still their default.
import React from 'react'
import type { ComponentConfig, Config, Field } from '@puckeditor/core'

export const PADDING_SIZES = ['none', 'sm', 'md', 'lg', 'xl'] as const
export type PaddingSize = (typeof PADDING_SIZES)[number]
export type Padding = { top?: PaddingSize | 'default'; bottom?: PaddingSize | 'default' }

const sizeOptions = [
  { label: 'Default', value: 'default' },
  { label: 'None', value: 'none' },
  { label: 'Small', value: 'sm' },
  { label: 'Medium', value: 'md' },
  { label: 'Large', value: 'lg' },
  { label: 'Extra large', value: 'xl' },
]

export const paddingField: Field<Padding> = {
  type: 'object',
  label: 'Padding',
  objectFields: {
    top: { type: 'select', label: 'Top', options: sizeOptions },
    bottom: { type: 'select', label: 'Bottom', options: sizeOptions },
  },
}

/** A saved value as a size, or undefined for the block's own padding (anything unknown included). */
export function paddingSize(value: unknown): PaddingSize | undefined {
  return (PADDING_SIZES as readonly unknown[]).includes(value) ? (value as PaddingSize) : undefined
}

/** Blocks that are only space themselves: padding would mean nothing. */
const SKIP = new Set(['Spacer'])
const WRAPPED = Symbol('withPadding')

/** The same config with the Padding option on every block (already wrapped blocks are left alone). */
export function withPadding<C extends Config>(config: C): C {
  const components = Object.fromEntries(
    Object.entries(config.components).map(([name, block]) => {
      const component = block as ComponentConfig & { [WRAPPED]?: true }
      if (SKIP.has(name) || component[WRAPPED]) return [name, component]
      const { spacing: _spacing, ...fields } = (component.fields ?? {}) as Record<string, unknown>
      const Original = component.render
      const wrapped = {
        ...component,
        [WRAPPED]: true,
        fields: { ...fields, padding: paddingField },
        render: (props: Record<string, unknown>) => {
          const padding = (props.padding ?? {}) as Padding
          const top = paddingSize(padding.top)
          const bottom = paddingSize(padding.bottom)
          const inner = (Original as (p: Record<string, unknown>) => React.ReactElement)(props)
          if (!top && !bottom) return inner
          return (
            <div className="block-pad" data-pt={top} data-pb={bottom}>
              {inner}
            </div>
          )
        },
      }
      return [name, wrapped]
    }),
  )
  return { ...config, components } as C
}
