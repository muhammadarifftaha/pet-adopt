// Shown while a screen loads its data: one plain line for every screen. A screen that wants a
// skeleton shaped like itself adds its own loading.tsx.
export default function Loading() {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Loading…
    </p>
  )
}
