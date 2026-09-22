/**
 * Parses the data URI the daemon's icon payload is wrapped in.
 *
 * This lives apart from `project-icon-image` on purpose: that module pulls in
 * `react-native-svg/css` and `Buffer` for the native SVG path, and
 * `project-icon-view` — which every icon surface renders through — only needs to
 * know whether a payload exists.
 *
 * A null result means the URI carries no bytes, which is the daemon reporting an
 * icon it cannot actually serve. Rendering it leaves a blank slot, so callers
 * treat null as "no icon" and draw the lettered fallback instead.
 */
export interface ParsedIconDataUri {
  mimeType: string;
  payload: string;
}

export function parseIconDataUri(dataUri: string): ParsedIconDataUri | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUri);
  if (!match) return null;

  const [, mimeType, payload] = match;
  return mimeType && payload ? { mimeType: mimeType.toLowerCase(), payload } : null;
}
