import { Badge } from '@/components/ui/badge'

// Pet statuses (available, pending, adopted ...) and page statuses (draft, published) share one badge.
// TODO(ui): pick the colours you want per status.
const VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  available: 'default',
  published: 'default',
  pending: 'secondary',
  draft: 'outline',
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={VARIANTS[status] ?? 'secondary'}>{status}</Badge>
}
