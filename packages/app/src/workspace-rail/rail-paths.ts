/**
 * The last path segment. A rail row names the file and dims the directories behind it, so the
 * filename is what the eye lands on and two files with the same name stay tellable apart.
 */
export function basenameOfRailPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}
