// Compiled after the production helper's declarations, without its stdin app loop.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
setenv("XDT_AGENT_ISLAND_DEBUG", "completion", 1)
let update = AgentIslandDebugHarness.makeUpdate()!
let screen = NSScreen.main!
let originalMouse = NSEvent.mouseLocation
let mainScreen = NSScreen.screens[0]

func movePointer(_ point: NSPoint) {
  CGWarpMouseCursorPosition(CGPoint(x: point.x, y: mainScreen.frame.maxY - point.y))
}

defer { movePointer(originalMouse) }

let controller = AgentIslandController(eventSink: { _ in })
let menuIcon = NSPoint(x: screen.frame.midX + 180, y: screen.frame.maxY - 12)
movePointer(menuIcon)
controller.apply(state: update.state, frame: update.frame)
let panel = app.windows.compactMap { $0 as? AgentIslandPanel }.first!
let metrics = AgentIslandScreenMetricsProvider.metrics(for: screen)
precondition(!controller.contains(screenPoint: menuIcon), "Expanded island intercepts a menu bar item")
let besideNotch = NSPoint(x: screen.frame.midX + CGFloat(metrics.notchWidth) / 2 + 5, y: screen.frame.maxY - 12)
precondition(!controller.contains(screenPoint: besideNotch), "Invisible compact wing intercepts a menu item")
precondition(panel.frame.maxY <= screen.frame.maxY - metrics.expandedTopInset, "Detail panel overlaps menu bar")
precondition(panel.ignoresMouseEvents, "Transparent carrier blocks menu clicks")
precondition(!panel.canBecomeKey && !panel.canBecomeMain, "Island steals keyboard focus")

let contentPoint = NSPoint(x: panel.frame.midX, y: panel.frame.maxY - 65)
movePointer(contentPoint)
controller.apply(state: update.state, frame: update.frame)
precondition(controller.contains(screenPoint: contentPoint), "Detail content is not interactive")
precondition(!panel.ignoresMouseEvents, "Detail buttons cannot receive clicks")

let shadowPoint = NSPoint(x: panel.frame.minX + 2, y: panel.frame.maxY - 65)
movePointer(shadowPoint)
controller.apply(state: update.state, frame: update.frame)
precondition(!controller.contains(screenPoint: shadowPoint), "Shadow claims a click target")
precondition(panel.ignoresMouseEvents, "Shadow blocks clicks on underlying apps")

let triggerPoint = NSPoint(x: screen.frame.midX, y: screen.frame.maxY - 12)
precondition(controller.contains(screenPoint: triggerPoint) == metrics.hasNotch, "Only the hardware notch should remain a trigger above the detail card")

let compactMetrics = AgentIslandScreenMetrics(
  displayId: 1, frame: AgentIslandRect(x: 0, y: 0, width: 1470, height: 956),
  hasNotch: true, notchWidth: 179, topBarHeight: 34, menuBarHeight: 34,
  safeAreaTop: 32, isMain: true, signature: "air"
)
precondition(compactMetrics.expandedTopInset == 34, "Menu bar can extend below the camera safe area")
let compact = AgentIslandLayout.compute(
  state: .empty, availableFrameWidth: 960, locallyHovered: false,
  notchBaselineHeight: 34, screenMetrics: compactMetrics, preferredContentWidth: 920
)
precondition(compact.width == 243, "Remembered compact width obscures the menu bar")
let hidden = AgentIslandLayout.compute(
  state: .empty, availableFrameWidth: 219, locallyHovered: false,
  notchBaselineHeight: 34, screenMetrics: compactMetrics, preferredContentWidth: 179
)
precondition(hidden.width == 179, "User's hidden notch preference is lost")

// Return to compact, then expand again: the menu-bar offset must not accumulate.
controller.apply(state: .empty, frame: update.frame)
RunLoop.main.run(until: Date().addingTimeInterval(0.5))
precondition(abs(panel.frame.maxY - screen.frame.maxY) < 1, "Compact panel does not return to the screen edge")
controller.apply(state: update.state, frame: update.frame)
precondition(abs(panel.frame.maxY - (screen.frame.maxY - metrics.expandedTopInset)) < 1, "Repeated expansion shifts the panel down")

// A layout update during a move is replayed using the current panel frame.
let dragStart = NSPoint(x: panel.frame.midX, y: panel.frame.maxY - 12)
movePointer(dragStart)
controller.apply(state: update.state, frame: update.frame)
func sendMouse(_ type: NSEvent.EventType, at point: NSPoint) {
  let event = NSEvent.mouseEvent(with: type, location: panel.convertPoint(fromScreen: point),
    modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
    windowNumber: panel.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
  app.sendEvent(event)
}
sendMouse(.leftMouseDown, at: dragStart)
let dragEnd = NSPoint(x: dragStart.x + 40, y: dragStart.y)
movePointer(dragEnd)
sendMouse(.leftMouseDragged, at: dragEnd)
controller.apply(state: update.state, frame: update.frame)
sendMouse(.leftMouseUp, at: dragEnd)
precondition(abs(panel.frame.maxY - (screen.frame.maxY - metrics.expandedTopInset)) < 1, "Deferred drag update applies menu-bar clearance twice")

setenv("XDT_AGENT_ISLAND_DEBUG", "interaction", 1)
let permissionUpdate = AgentIslandDebugHarness.makeUpdate()!
controller.apply(state: permissionUpdate.state, frame: permissionUpdate.frame)
precondition(!controller.contains(screenPoint: menuIcon), "Permission card blocks the menu bar")

// Optional local visual QA; does not capture the desktop or another app.
if let output = ProcessInfo.processInfo.environment["PASEO_ISLAND_QA_IMAGE"],
   let content = panel.contentView {
  RunLoop.main.run(until: Date().addingTimeInterval(0.8))
  content.layoutSubtreeIfNeeded()
  if let bitmap = content.bitmapImageRepForCachingDisplay(in: content.bounds) {
    content.cacheDisplay(in: content.bounds, to: bitmap)
    try! bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output))
  }
}
controller.close()
print("PASS: menu bar clearance, mouse passthrough, detail interaction, focus, compact bounds")
