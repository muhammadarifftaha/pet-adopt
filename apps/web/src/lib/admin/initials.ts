const firstLetter = (text: string) => [...text][0] ?? "";

/** "Scratch Owner" -> "SO", "Mochi" -> "M", no name -> the email's first letter. Spreading the
 * string keeps letters in any script whole. Used by every avatar in the admin. */
export function initialsOf(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const source = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0] ?? email];
  return source.map(firstLetter).join("").toUpperCase();
}
