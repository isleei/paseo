import { Platform } from "react-native";

declare const navigator: { language?: string } | undefined;

// Web-only language probe. The plugin tsconfig omits the DOM lib, so only
// the globals declared here are visible, and every export is gated on
// Platform.OS === "web" with a native no-op fallback.
export function getWebLanguage(): string | null {
  if (Platform.OS !== "web") return null;
  try {
    return typeof navigator !== "undefined" && navigator.language ? navigator.language : null;
  } catch {
    return null;
  }
}
