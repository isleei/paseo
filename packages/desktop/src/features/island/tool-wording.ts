/**
 * Paseo port: static tool wording for the island (Cindy resolved these via
 * main-process i18n; Paseo keeps a static table until island settings gain
 * locale support).
 */
import type { IslandToolRowWording } from "./tool-detail.js";

export function createIslandToolWording(): IslandToolRowWording {
  return { running: "Running" };
}
