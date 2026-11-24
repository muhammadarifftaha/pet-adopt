import React from 'react'
import {
  FiActivity,
  FiAward,
  FiBookOpen,
  FiCheckCircle,
  FiClock,
  FiDollarSign,
  FiGift,
  FiHeart,
  FiHome,
  FiMapPin,
  FiMessageCircle,
  FiShield,
  FiSmile,
  FiStar,
  FiTruck,
  FiUsers,
} from 'react-icons/fi'

import type { NavIcon, NavIconNode } from '@/components/admin/nav-items'
import { toNavIcon } from '@/plugins/icon'

// The icons a block can show (Feather, from react-icons). react-icons cannot render on the server,
// where the public pages draw blocks, so each icon is read once into plain SVG data (`toNavIcon`,
// the same check the plugin menu uses) and drawn here with plain elements. No hooks: blocks render
// on the server and in the editor alike.

const SOURCES = {
  heart: { label: 'Heart', icon: FiHeart },
  home: { label: 'Home', icon: FiHome },
  shield: { label: 'Shield', icon: FiShield },
  check: { label: 'Check', icon: FiCheckCircle },
  star: { label: 'Star', icon: FiStar },
  smile: { label: 'Smile', icon: FiSmile },
  gift: { label: 'Gift', icon: FiGift },
  users: { label: 'People', icon: FiUsers },
  message: { label: 'Message', icon: FiMessageCircle },
  pin: { label: 'Map pin', icon: FiMapPin },
  clock: { label: 'Clock', icon: FiClock },
  award: { label: 'Award', icon: FiAward },
  health: { label: 'Health', icon: FiActivity },
  money: { label: 'Money', icon: FiDollarSign },
  transport: { label: 'Transport', icon: FiTruck },
  book: { label: 'Book', icon: FiBookOpen },
} as const

export type BlockIconKey = keyof typeof SOURCES

const DATA: Record<BlockIconKey, NavIcon> = Object.fromEntries(
  Object.entries(SOURCES).map(([key, { icon }]) => [key, toNavIcon(icon)]),
) as Record<BlockIconKey, NavIcon>

/** For a Puck select field: "No icon" plus every icon, by label. */
export const BLOCK_ICON_OPTIONS = [
  { label: 'No icon', value: '' },
  ...(Object.keys(SOURCES) as BlockIconKey[]).map((value) => ({ label: SOURCES[value].label, value })),
]

const isIconKey = (value: unknown): value is BlockIconKey => typeof value === 'string' && value in SOURCES

// React wants camelCase SVG attributes; react-icons data already uses them (strokeWidth...).
function draw(nodes: NavIconNode[]): React.ReactNode {
  return nodes.map((node, i) => React.createElement(node.tag, { key: i, ...node.attr }, draw(node.child)))
}

/** A decorative icon (aria-hidden): the text next to it says what it means. Unknown keys draw nothing. */
export function BlockIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  if (!isIconKey(name)) return null
  const icon = DATA[name]
  return (
    <svg {...icon.attr} className={className} width="1em" height="1em" aria-hidden="true" focusable="false">
      {draw(icon.child)}
    </svg>
  )
}
