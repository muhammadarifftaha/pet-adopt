import { Badge } from '@pet-adopt/ui/components/badge'

// Pet statuses (available, pending, adopted ...) and page states (draft, published, archived) share one
// badge. Keys are the stored lower-case values; anything else gets `secondary`.
const VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  available: 'default',
  published: 'default',
  pending: 'secondary',
  draft: 'outline',
  archived: 'secondary',
}

/** `label` overrides the text shown (the raw status by default). */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge variant={VARIANTS[status] ?? 'secondary'}>{label ?? status}</Badge>
}
