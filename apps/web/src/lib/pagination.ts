/**
 * The page numbers to show in a pager: the first and last page, the current one and one on each
 * side. A gap becomes `null` (an ellipsis), except a gap of a single page, which just shows that
 * page (an ellipsis would hide one number and take more room than the number does).
 *
 *   pageItems(1, 3)   -> [1, 2, 3]
 *   pageItems(1, 20)  -> [1, 2, null, 20]
 *   pageItems(10, 20) -> [1, null, 9, 10, 11, null, 20]
 *   pageItems(3, 20)  -> [1, 2, 3, 4, null, 20]
 */
export function pageItems(page: number, totalPages: number): Array<number | null> {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1)

  const shown = [...new Set([1, page - 1, page, page + 1, totalPages])]
    .filter((n) => n >= 1 && n <= totalPages)
    .sort((a, b) => a - b)

  const items: Array<number | null> = []
  shown.forEach((n, i) => {
    const previous = shown[i - 1]
    if (previous !== undefined) {
      if (n - previous === 2) items.push(previous + 1)
      else if (n - previous > 2) items.push(null)
    }
    items.push(n)
  })
  return items
}
