import { useCallback, useEffect, useState } from "react";
import { getIsElectronRuntimeMac } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { getDesktopHost } from "@/desktop/host";

export const ISLAND_MASCOT_SKINS = [
  "paimon",
  "cindy",
  "blackcat",
  "pululu",
  "tarara",
  "boli",
  "whitesnow",
  "annie",
  "chaku",
  "muffin",
  "erika",
] as const;

export type IslandMascotSkin = (typeof ISLAND_MASCOT_SKINS)[number];

const STORAGE_ENABLED_KEY = "paseo.island.enabled";
const STORAGE_SKIN_KEY = "paseo.island.mascotSkin";

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (!isWeb || typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    // Storage may be unavailable (private mode); fall through to defaults.
  }
  return fallback;
}

function readStoredSkin(): IslandMascotSkin {
  if (!isWeb || typeof localStorage === "undefined") return "paimon";
  try {
    const raw = localStorage.getItem(STORAGE_SKIN_KEY);
    if (raw && (ISLAND_MASCOT_SKINS as readonly string[]).includes(raw)) {
      return raw as IslandMascotSkin;
    }
  } catch {
    // Ignore storage failures; fall through to default.
  }
  return "paimon";
}

function writeStored(key: string, value: string): void {
  if (!isWeb || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Best effort only.
  }
}

export interface IslandSettings {
  isSupported: boolean;
  isLoading: boolean;
  enabled: boolean;
  mascotSkin: IslandMascotSkin;
  setEnabled: (enabled: boolean) => void;
  setMascotSkin: (skin: IslandMascotSkin) => void;
}

/**
 * Agent Island preferences (Electron-Mac only). Renderer-owned localStorage is
 * the source of truth; values are pushed to the main-process island service.
 */
export function useIslandSettings(): IslandSettings {
  const isSupported = !isNative && getIsElectronRuntimeMac();
  const [isLoading, setIsLoading] = useState(true);
  const [enabled, setEnabledState] = useState(() => readStoredBoolean(STORAGE_ENABLED_KEY, true));
  const [mascotSkin, setMascotSkinState] = useState<IslandMascotSkin>(readStoredSkin);

  useEffect(() => {
    if (!isSupported) {
      setIsLoading(false);
      return;
    }
    let disposed = false;
    const island = getDesktopHost()?.island;
    const getState = island?.getState;
    if (typeof getState !== "function") {
      setIsLoading(false);
      return;
    }
    void (async () => {
      try {
        const state = await getState();
        if (disposed) return;
        if (typeof state.enabled === "boolean") {
          setEnabledState(state.enabled);
          writeStored(STORAGE_ENABLED_KEY, String(state.enabled));
        }
        if (
          typeof state.mascotSkin === "string" &&
          (ISLAND_MASCOT_SKINS as readonly string[]).includes(state.mascotSkin)
        ) {
          setMascotSkinState(state.mascotSkin as IslandMascotSkin);
          writeStored(STORAGE_SKIN_KEY, state.mascotSkin);
        }
      } catch {
        // Main may predate the island IPC; stored values still apply below.
      } finally {
        if (!disposed) setIsLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [isSupported]);

  const setEnabled = useCallback(
    (next: boolean) => {
      setEnabledState(next);
      writeStored(STORAGE_ENABLED_KEY, String(next));
      if (!isSupported) return;
      void getDesktopHost()
        ?.island?.setEnabled?.(next)
        .catch((error) => {
          console.warn("[island] setEnabled failed", error);
        });
    },
    [isSupported],
  );

  const setMascotSkin = useCallback(
    (skin: IslandMascotSkin) => {
      setMascotSkinState(skin);
      writeStored(STORAGE_SKIN_KEY, skin);
      if (!isSupported) return;
      void getDesktopHost()
        ?.island?.setMascotSkin?.(skin)
        .catch((error) => {
          console.warn("[island] setMascotSkin failed", error);
        });
    },
    [isSupported],
  );

  return { isSupported, isLoading, enabled, mascotSkin, setEnabled, setMascotSkin };
}
