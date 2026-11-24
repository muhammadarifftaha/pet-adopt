// Shown while a screen loads its data. TODO(ui): replace with skeletons shaped like the screen.
export default function Loading() {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Loading…
    </p>
  )
}
