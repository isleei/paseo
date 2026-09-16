import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedStyle,
} from "react-native-reanimated";
import type Animated from "react-native-reanimated";
import {
  SIDEBAR_TOGGLE_DURATION_MS,
  SIDEBAR_TOGGLE_EASING,
} from "@/components/sidebar-toggle-animation";
import { removeWindowChromeCorner, type WindowChromeCorners } from "@/utils/desktop-window";

/** Matches `ResizeHandle` horizontal width (`styles.handleHorizontal`). */
export const EXPLORER_SIDEBAR_RESIZE_HANDLE_WIDTH = 1;

interface UseExplorerSidebarPresentationInput {
  /** True when the dock should be visually open (not focus mode, pane visible). */
  open: boolean;
  /** The explorer pane exists in the layout (it may still be hidden). */
  hasPane: boolean;
  /** Settled width of the dock body (excluding the resize handle). */
  dockWidth: number;
  hasRail: boolean;
  inheritedWindowChromeCorners: WindowChromeCorners;
  dockStyle: StyleProp<ViewStyle>;
}

interface ExplorerSidebarPresentation {
  open: boolean;
  shouldRender: boolean;
  showRailPadding: boolean;
  mainColumnWindowChromeCorners: WindowChromeCorners;
  animatedGroupStyle: AnimatedStyle<{ width: number }>;
  dockStyle: StyleProp<ViewStyle>;
  pointerEvents: ComponentProps<typeof Animated.View>["pointerEvents"];
  accessible: boolean;
}

/**
 * Slides the explorer dock + its resize handle open/closed, and derives the
 * main-column layout that must stay stable until the slide-out finishes.
 *
 * Stays mounted through the close animation (`shouldRender`) so the panel can
 * slide out instead of unmounting instantly. While already open, width snaps so
 * drag-preview and viewport resizes stay 1:1.
 */
export function useExplorerSidebarPresentation({
  open,
  hasPane,
  dockWidth,
  hasRail,
  inheritedWindowChromeCorners,
  dockStyle,
}: UseExplorerSidebarPresentationInput): ExplorerSidebarPresentation {
  const [settledClosed, setSettledClosed] = useState(!open);
  const prevOpenRef = useRef(open);
  const groupWidth = open ? EXPLORER_SIDEBAR_RESIZE_HANDLE_WIDTH + dockWidth : 0;
  const animatedWidth = useSharedValue(groupWidth);

  useEffect(() => {
    if (open) {
      setSettledClosed(false);
      if (prevOpenRef.current) {
        animatedWidth.value = groupWidth;
      } else {
        animatedWidth.value = withTiming(groupWidth, {
          duration: SIDEBAR_TOGGLE_DURATION_MS,
          easing: SIDEBAR_TOGGLE_EASING,
        });
      }
    } else {
      animatedWidth.value = withTiming(0, {
        duration: SIDEBAR_TOGGLE_DURATION_MS,
        easing: SIDEBAR_TOGGLE_EASING,
      });
      const settleTimer = setTimeout(() => {
        setSettledClosed(true);
      }, SIDEBAR_TOGGLE_DURATION_MS);
      prevOpenRef.current = open;
      return () => clearTimeout(settleTimer);
    }
    prevOpenRef.current = open;
  }, [animatedWidth, groupWidth, open]);

  const animatedGroupStyle = useAnimatedStyle(() => ({
    width: animatedWidth.value,
  }));

  return useMemo(() => {
    const shouldRender = hasPane && (open || !settledClosed);
    return {
      open,
      shouldRender,
      // Keep treating the dock as present until the slide-out finishes, otherwise
      // rail padding / chrome corners jump mid-animation.
      showRailPadding: hasRail && !shouldRender,
      mainColumnWindowChromeCorners: shouldRender
        ? removeWindowChromeCorner(inheritedWindowChromeCorners, "top-right")
        : inheritedWindowChromeCorners,
      animatedGroupStyle,
      dockStyle,
      pointerEvents: (open ? "auto" : "none") as ComponentProps<
        typeof Animated.View
      >["pointerEvents"],
      accessible: open,
    };
  }, [
    animatedGroupStyle,
    dockStyle,
    hasPane,
    hasRail,
    inheritedWindowChromeCorners,
    open,
    settledClosed,
  ]);
}
