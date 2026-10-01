let app = NSApplication.shared
app.setActivationPolicy(.accessory)
app.finishLaunching()
MainActor.assumeIsolated {
  var events: [[String: Any]] = []
  let controller = AgentMenuBarController { events.append($0) }
  defer { controller.close() }
  precondition(controller.statusItem.length == NSStatusItem.squareLength, "Status item must occupy one icon slot")
  precondition(controller.statusItem.button?.image != nil, "Missing mascot icon")
  precondition(!controller.popover.isShown, "Idle state opens a window")
  precondition(!controller.model.open, "Hidden popover animates")
  precondition(controller.model.state.indicator == nil, "Idle icon shows attention")

  let session = AgentIslandSession(sessionId: "test", title: "Review changes", projectName: "Paimon",
    detail: "Approve file edit", compactDetail: "Approve file edit", messagePreview: nil,
    phase: "needs-interaction", agentKind: "codex", interactionKind: "permission",
    permissionAction: AgentIslandPermissionAction(requestId: "request", canAllowForSession: true),
    attention: true, activityLines: [], startedAt: 1000, lastActivityAt: 2000)
  let state = AgentMenuBarState(sessions: [session], strings: .fallback, soundSettings: .fallback,
    mascotSkin: "paimon", updatedAt: 3000)
  controller.apply(state: state)
  precondition(!controller.popover.isShown, "Attention update automatically opens popover")
  precondition(controller.statusItem.length == NSStatusItem.squareLength, "Task count widens menu bar item")
  precondition(controller.model.state.waitingCount == 1, "Missing pending permission count")
  precondition(controller.model.state.indicator == .systemOrange, "Permission does not set indicator")
  RunLoop.main.run(until: Date().addingTimeInterval(0.2))
  controller.statusItem.button?.performClick(nil)
  RunLoop.main.run(until: Date().addingTimeInterval(0.4))
  precondition(controller.popover.isShown, "Click does not open native popover")
  precondition(controller.model.open, "Opened popover does not activate content")
  controller.apply(state: state)
  precondition(controller.popover.isShown, "Update closes user-opened popover")
  controller.model.pendingRequests.insert("request")
  controller.permissionResult(requestId: "request", error: "Host disconnected")
  precondition(controller.model.pendingRequests.isEmpty, "Failed action cannot be retried")
  precondition(controller.model.permissionErrors["request"] == "Host disconnected", "Permission error is lost")
  controller.permissionResult(requestId: "request", error: nil)
  precondition(controller.model.permissionErrors.isEmpty, "Successful retry leaves error visible")

  if let directory = ProcessInfo.processInfo.environment["PASEO_MENU_BAR_QA_DIR"] {
    for (name, appearance) in [("light", NSAppearance.Name.aqua), ("dark", NSAppearance.Name.darkAqua)] {
      controller.popover.appearance = NSAppearance(named: appearance)
      RunLoop.main.run(until: Date().addingTimeInterval(0.3))
      let view = controller.popover.contentViewController!.view
      if let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
        view.cacheDisplay(in: view.bounds, to: bitmap)
        try! bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(directory)/\(name).png"))
      }
    }
    let image = controller.statusItem.button!.image!
    let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
    try! bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(directory)/icon.png"))
  }

  controller.handleAction(["type": "focus-session", "sessionId": "test"])
  RunLoop.main.run(until: Date().addingTimeInterval(0.3))
  precondition(!controller.popover.isShown, "Navigation leaves popover open")
  precondition(events.last?["type"] as? String == "focus-session", "Task navigation not forwarded")
  controller.apply(state: state)
  precondition(!controller.popover.isShown, "Later update reopens popover")
  controller.togglePopover()
  controller.togglePopover()
  RunLoop.main.run(until: Date().addingTimeInterval(0.3))
  precondition(!controller.popover.isShown, "Second click does not close popover")
  precondition(!controller.model.open, "Closed popover keeps animations active")
  controller.apply(state: .empty)
  precondition(controller.statusItem.button?.image != nil, "Idle update removes entry")
  controller.close()
  precondition(!controller.popover.isShown, "Shutdown leaves popover open")
  print("PASS: native status item, click-only popover, counts, navigation, permission errors, cleanup")
}
