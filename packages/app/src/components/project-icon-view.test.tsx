import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectIconView } from "./project-icon-view";

vi.mock("@/components/project-icon-image", () => ({
  ProjectIconImage: ({ dataUri }: { dataUri: string }) =>
    React.createElement("div", { "data-testid": "project-icon-image", "data-uri": dataUri }),
}));

const EMPTY_ICON_URI = "data:image/x-icon;base64,";
const PNG_ICON_URI = "data:image/png;base64,AAAA";
const TEXT_STYLE = { fontSize: 9 } as const;

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("navigator", dom.window.navigator);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

function render(element: React.ReactElement) {
  act(() => {
    root?.render(element);
  });
}

function renderIcon(iconDataUri: string | null) {
  render(
    <ProjectIconView
      initial="L"
      iconDataUri={iconDataUri}
      projectViewKey="host:srv_1:/work/lhw-api"
      size={16}
      textStyle={TEXT_STYLE}
    />,
  );
}

function queryImage(): HTMLElement | null {
  return document.querySelector('[data-testid="project-icon-image"]');
}

describe("ProjectIconView", () => {
  it("draws the initial when the project has no icon", () => {
    renderIcon(null);

    expect(container?.textContent).toBe("L");
    expect(queryImage()).toBeNull();
  });

  it("draws the initial when the icon payload is empty", () => {
    // The daemon reports this for a discovered file it cannot serve — an empty
    // public/favicon.ico is the common case. Rendering the URI draws nothing and
    // hides the initial, which is the bug this guards.
    renderIcon(EMPTY_ICON_URI);

    expect(container?.textContent).toBe("L");
    expect(queryImage()).toBeNull();
  });

  it("draws the icon when the payload has bytes", () => {
    renderIcon(PNG_ICON_URI);

    expect(queryImage()?.getAttribute("data-uri")).toBe(PNG_ICON_URI);
    expect(container?.textContent).not.toBe("L");
  });
});
