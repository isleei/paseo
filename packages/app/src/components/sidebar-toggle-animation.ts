import { Easing } from "react-native-reanimated";

/** Shared open/close motion for desktop sidebars (left agent list + right explorer). */
export const SIDEBAR_TOGGLE_DURATION_MS = 220;
export const SIDEBAR_TOGGLE_EASING = Easing.bezier(0.25, 0.1, 0.25, 1);
