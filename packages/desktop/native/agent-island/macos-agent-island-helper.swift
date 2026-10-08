import AppKit
import Foundation
import QuartzCore
import SwiftUI

private let agentIslandSoundIds: Set<String> = [
  "startup-chime",
  "ring-chime",
  "item-found",
  "gem-collect",
  "item-fanfare",
  "victory-fanfare",
  "error-buzz",
  "secret-chime",
]

final class AgentIslandSoundPlayer: NSObject, NSSoundDelegate {
  static let shared = AgentIslandSoundPlayer()

  private var activeSounds: [NSSound] = []

  func play(soundId: String) {
    guard agentIslandSoundIds.contains(soundId), let url = soundURL(soundId: soundId) else {
      return
    }
    play(url: url)
  }

  func play(filePath: String) {
    guard !filePath.isEmpty else { return }
    let url = URL(fileURLWithPath: filePath)
    guard FileManager.default.fileExists(atPath: url.path) else {
      return
    }
    play(url: url)
  }

  private func play(url: URL) {
    guard let sound = NSSound(contentsOf: url, byReference: false) else {
      return
    }
    sound.volume = 0.58
    sound.delegate = self
    activeSounds.append(sound)
    sound.play()
  }

  func sound(_ sound: NSSound, didFinishPlaying flag: Bool) {
    activeSounds.removeAll { $0 === sound }
  }

  private func soundURL(soundId: String) -> URL? {
    for base in soundBaseDirectories() {
      let url = base
        .appendingPathComponent("sounds", isDirectory: true)
        .appendingPathComponent("\(soundId).mp3")
      if FileManager.default.fileExists(atPath: url.path) {
        return url
      }
    }
    return nil
  }

  private func soundBaseDirectories() -> [URL] {
    var urls: [URL] = []
    let environment = ProcessInfo.processInfo.environment
    if let assetDir = environment["XDT_AGENT_ISLAND_ASSET_DIR"], !assetDir.isEmpty {
      urls.append(URL(fileURLWithPath: assetDir))
    }
    if let executablePath = CommandLine.arguments.first, !executablePath.isEmpty {
      urls.append(URL(fileURLWithPath: executablePath).deletingLastPathComponent())
    }
    urls.append(
      URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        .appendingPathComponent("apps")
        .appendingPathComponent("desktop")
        .appendingPathComponent("native")
        .appendingPathComponent("agent-island")
    )
    return urls
  }
}

enum AgentIslandMascotAnimationState: Equatable {
  case idle
  case working
  case waitingApproval
  case completed
}

private struct AgentIslandMascotAnimationsActiveKey: EnvironmentKey {
  static let defaultValue = true
}

private struct AgentIslandMascotAnimationEpochKey: EnvironmentKey {
  static let defaultValue = 0
}

private extension EnvironmentValues {
  var agentIslandMascotAnimationsActive: Bool {
    get { self[AgentIslandMascotAnimationsActiveKey.self] }
    set { self[AgentIslandMascotAnimationsActiveKey.self] = newValue }
  }

  var agentIslandMascotAnimationEpoch: Int {
    get { self[AgentIslandMascotAnimationEpochKey.self] }
    set { self[AgentIslandMascotAnimationEpochKey.self] = newValue }
  }
}

private extension View {
  func agentIslandMascotAnimationsActive(_ active: Bool) -> some View {
    environment(\.agentIslandMascotAnimationsActive, active)
  }

  func agentIslandMascotAnimationEpoch(_ epoch: Int) -> some View {
    environment(\.agentIslandMascotAnimationEpoch, epoch)
  }
}

private func agentIslandMascotLerp(_ keyframes: [(CGFloat, CGFloat)], at pct: CGFloat) -> CGFloat {
  guard let first = keyframes.first else { return 0 }
  if pct <= first.0 { return first.1 }
  for index in 1..<keyframes.count {
    if pct <= keyframes[index].0 {
      let span = keyframes[index].0 - keyframes[index - 1].0
      guard span > 0 else { return keyframes[index].1 }
      let t = (pct - keyframes[index - 1].0) / span
      return keyframes[index - 1].1 + (keyframes[index].1 - keyframes[index - 1].1) * t
    }
  }
  return keyframes.last?.1 ?? 0
}

struct PululuMascotView: View {
  let size: CGFloat
  let state: AgentIslandMascotAnimationState
  @State private var alive = false
  @State private var timelineStart = Date().timeIntervalSinceReferenceDate
  @Environment(\.agentIslandMascotAnimationsActive) private var animationsActive
  @Environment(\.agentIslandMascotAnimationEpoch) private var animationEpoch

  private static let shellC = Color(red: 0.91, green: 0.93, blue: 0.96)
  private static let faceC = Color(red: 0.29, green: 0.29, blue: 0.34)
  private static let footC = Color(red: 0.95, green: 0.85, blue: 0.45)
  private static let eyeC = Color(red: 0.96, green: 0.97, blue: 1.0)
  private static let alertC = Color(red: 0.0, green: 0.85, blue: 0.77)
  private static let approvalGlowC = Color(red: 1.0, green: 0.72, blue: 0.20)
  private static let kbBase = Color(red: 0.16, green: 0.18, blue: 0.23)
  private static let kbKey = Color(red: 0.44, green: 0.49, blue: 0.58)
  private static let kbHi = Color.white
  private static let idleCycleDuration: Double = 4.8
  private static let idleSleepStart: Double = 1.15

  var body: some View {
    ZStack {
      switch state {
      case .idle:
        sleepScene
      case .working:
        workScene
      case .waitingApproval:
        alertScene
      case .completed:
        completionScene
      }
    }
    .frame(width: size, height: size)
    .clipped()
    .onAppear {
      restartTimeline()
    }
    .onChange(of: state) { _, _ in
      restartTimeline()
    }
    .onChange(of: animationEpoch) { _, _ in
      restartTimeline()
    }
  }

  @ViewBuilder
  private func timeline<Content: View>(
    every interval: TimeInterval,
    staticTime: Double = 0,
    @ViewBuilder content: @escaping (Double) -> Content
  ) -> some View {
    if animationsActive {
      TimelineView(.periodic(from: .now, by: interval)) { ctx in
        content(ctx.date.timeIntervalSinceReferenceDate - timelineStart)
      }
      .id(animationEpoch)
    } else {
      content(staticTime)
    }
  }

  private func restartTimeline() {
    alive = false
    timelineStart = Date().timeIntervalSinceReferenceDate
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
      alive = true
    }
  }

  private struct V {
    let ox: CGFloat
    let oy: CGFloat
    let s: CGFloat

    init(_ sz: CGSize, w: CGFloat = 16, h: CGFloat = 16) {
      s = min(sz.width / w, sz.height / h)
      ox = (sz.width - w * s) / 2
      oy = (sz.height - h * s) / 2
    }

    func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, dy: CGFloat = 0) -> CGRect {
      CGRect(x: ox + x * s, y: oy + (y + dy) * s, width: w * s, height: h * s)
    }

    func ellipse(cx: CGFloat, cy: CGFloat, rx: CGFloat, ry: CGFloat? = nil, dy: CGFloat = 0) -> CGRect {
      let ey = ry ?? rx
      return rect(cx - rx, cy - ey, rx * 2, ey * 2, dy: dy)
    }
  }

  private func rounded(_ rect: CGRect, radius: CGFloat) -> Path {
    Path(roundedRect: rect, cornerRadius: radius)
  }

  private func drawShadow(_ c: GraphicsContext, v: V, width: CGFloat, opacity: Double, dy: CGFloat = 0) {
    c.fill(
      Path(ellipseIn: v.ellipse(cx: 8, cy: 14.0, rx: width / 2, ry: 0.55, dy: dy)),
      with: .color(.black.opacity(opacity))
    )
  }

  private func drawPululu(
    _ c: GraphicsContext,
    v: V,
    dy: CGFloat = 0,
    squashX: CGFloat = 1,
    squashY: CGFloat = 1,
    eyeScale: CGFloat = 1,
    eyeOpacity: Double = 1,
    eyeYOffset: CGFloat = 0,
    eyesBright: Bool = false,
    headAngle: CGFloat = 0
  ) {
    let shellRx = 5.95 * squashX
    let shellRy = 5.95 * squashY
    let shellCy = 8.15 + (1 - squashY) * 2.2
    let faceRx = 4.15 * squashX
    let faceRy = 4.15 * squashY
    let faceCy = 6.95 + (1 - squashY) * 1.7

    c.fill(
      Path(ellipseIn: v.ellipse(cx: 8, cy: shellCy, rx: shellRx, ry: shellRy, dy: dy)),
      with: .color(Self.shellC)
    )

    var head = c
    if abs(headAngle) > 0.001 {
      let center = CGPoint(x: v.ox + 8 * v.s, y: v.oy + (faceCy + dy) * v.s)
      head.translateBy(x: center.x, y: center.y)
      head.rotate(by: .radians(Double(headAngle)))
      head.translateBy(x: -center.x, y: -center.y)
    }

    head.fill(
      Path(ellipseIn: v.ellipse(cx: 8, cy: faceCy, rx: faceRx, ry: faceRy, dy: dy)),
      with: .color(Self.faceC)
    )
    drawEyes(head, v: v, dy: dy + eyeYOffset, scale: eyeScale, opacity: eyeOpacity, bright: eyesBright)

    c.fill(
      Path(ellipseIn: v.ellipse(cx: 4.45, cy: 11.25, rx: 1.1, ry: 1.25, dy: dy)),
      with: .color(Self.footC)
    )
    c.fill(
      Path(ellipseIn: v.ellipse(cx: 11.55, cy: 11.25, rx: 1.1, ry: 1.25, dy: dy)),
      with: .color(Self.footC)
    )
  }

  private func drawEyes(
    _ c: GraphicsContext,
    v: V,
    dy: CGFloat,
    scale: CGFloat,
    opacity: Double,
    bright: Bool
  ) {
    let openness = scale < 0.25 ? 0 : min(scale, 1.25)
    let closed = 1 - min(openness, 1)
    let w = 1.30 + closed * 0.08
    let h = 0.22 + openness * 1.58
    let cy: CGFloat = 6.72
    let left = v.rect(6.05 - w / 2, cy - h / 2, w, h, dy: dy)
    let right = v.rect(9.95 - w / 2, cy - h / 2, w, h, dy: dy)
    let color = bright ? Color.white : Self.eyeC
    let radius = min(w, h) * v.s * 0.5

    if bright {
      c.fill(
        rounded(left.insetBy(dx: -0.1 * v.s, dy: -0.12 * v.s), radius: radius),
        with: .color(Color(red: 0.52, green: 0.61, blue: 1.0).opacity(0.26))
      )
      c.fill(
        rounded(right.insetBy(dx: -0.1 * v.s, dy: -0.12 * v.s), radius: radius),
        with: .color(Color(red: 0.52, green: 0.61, blue: 1.0).opacity(0.26))
      )
    }

    c.fill(rounded(left, radius: radius), with: .color(color.opacity(opacity)))
    c.fill(rounded(right, radius: radius), with: .color(color.opacity(opacity)))
  }

  private func drawKeyboard(_ c: GraphicsContext, v: V, phase: Int, dy: CGFloat) {
    c.fill(Path(v.rect(0.5, 12.0, 15, 3, dy: dy)), with: .color(Self.kbBase))
    for row in 0..<2 {
      let ky = 12.5 + CGFloat(row) * 1.2
      for col in 0..<6 {
        let kx = 1.0 + CGFloat(col) * 2.4
        c.fill(Path(v.rect(kx, ky, 1.8, 0.7, dy: dy)), with: .color(Self.kbKey))
      }
    }

    let flashRow = phase / 3
    let flashCol = phase % 6
    let fkx = 1.0 + CGFloat(flashCol) * 2.4
    let fky = 12.5 + CGFloat(flashRow) * 1.2
    c.fill(Path(v.rect(fkx, fky, 1.8, 0.7, dy: dy)), with: .color(Self.kbHi.opacity(0.9)))
  }

  private func drawBang(_ c: GraphicsContext, v: V, pct: CGFloat, jumpY: CGFloat) {
    let opacity = agentIslandMascotLerp([
      (0, 0), (0.03, 1), (0.10, 1), (0.55, 1), (0.62, 0), (1, 0),
    ], at: pct)
    guard opacity > 0.01 else { return }

    let scale = agentIslandMascotLerp([
      (0, 0.3), (0.03, 1.3), (0.10, 1.0), (0.55, 1.0), (0.62, 0.6), (1, 0.6),
    ], at: pct)
    let bw: CGFloat = 1.65 * scale
    let bx: CGFloat = 13
    let by: CGFloat = 1.0 + jumpY * 0.15
    c.fill(
      rounded(v.rect(bx, by, bw, 3.5 * scale, dy: 0), radius: bw * v.s * 0.45),
      with: .color(Self.alertC.opacity(Double(opacity)))
    )
    c.fill(
      rounded(v.rect(bx, by + 4.05 * scale, bw, 1.45 * scale, dy: 0), radius: bw * v.s * 0.45),
      with: .color(Self.alertC.opacity(Double(opacity)))
    )
  }

  private func drawCompletionBadge(_ c: GraphicsContext, v: V, pct: CGFloat) {
    let fade = pct < 0.92 ? 1.0 : max(0, (1.0 - pct) / 0.08)
    let badgeScale = agentIslandMascotLerp([
      (0, 0.15), (0.10, 1.20), (0.20, 0.94),
      (0.32, 1.0), (0.92, 1.0), (1, 0.90),
    ], at: pct)
    let cx: CGFloat = 8
    let cy: CGFloat = 8.05
    let badgeR: CGFloat = 5.95 * badgeScale

    c.fill(
      Path(ellipseIn: v.ellipse(cx: cx, cy: cy, rx: badgeR, ry: badgeR)),
      with: .color(Self.alertC.opacity(Double(fade)))
    )
    c.fill(
      Path(ellipseIn: v.ellipse(
        cx: cx - 1.55 * badgeScale,
        cy: cy - 1.85 * badgeScale,
        rx: 1.08 * badgeScale,
        ry: 0.55 * badgeScale
      )),
      with: .color(Color.white.opacity(Double(0.25 * fade)))
    )

    var check = Path()
    check.move(to: CGPoint(x: v.ox + (cx - 2.38 * badgeScale) * v.s, y: v.oy + (cy + 0.18 * badgeScale) * v.s))
    check.addLine(to: CGPoint(x: v.ox + (cx - 0.62 * badgeScale) * v.s, y: v.oy + (cy + 1.86 * badgeScale) * v.s))
    check.addLine(to: CGPoint(x: v.ox + (cx + 2.92 * badgeScale) * v.s, y: v.oy + (cy - 2.10 * badgeScale) * v.s))
    c.stroke(
      check,
      with: .color(Color.white.opacity(Double(fade))),
      style: StrokeStyle(lineWidth: 1.10 * badgeScale * v.s, lineCap: .round, lineJoin: .round)
    )
  }

  private var sleepScene: some View {
    ZStack {
      timeline(every: 0.06) { t in
        sleepCanvas(t: t)
      }
      timeline(every: 0.05) { t in
        floatingZs(t: t)
      }
    }
  }

  private func floatingZs(t: Double) -> some View {
    ZStack {
      ForEach(0..<3, id: \.self) { i in
        let ci = Double(i)
        let idleTime = t.truncatingRemainder(dividingBy: Self.idleCycleDuration)
        let sleepElapsed = idleTime - Self.idleSleepStart
        let cycle = 2.8 + ci * 0.3
        let delay = ci * 0.9
        let localT = sleepElapsed - delay
        let phase = localT >= 0 ? (localT.truncatingRemainder(dividingBy: cycle)) / cycle : 0
        let p = max(0, phase)
        let fontSize = max(6, size * CGFloat(0.18 + p * 0.10))
        let baseOpacity = 0.7 - ci * 0.1
        let sleepOpacity = sleepElapsed >= delay ? 1.0 : 0.0
        let opacity = sleepOpacity * (p < 0.8 ? baseOpacity : (1.0 - p) * 3.5 * baseOpacity)
        let xOff = size * CGFloat(0.08 + ci * 0.06 + sin(p * .pi * 2) * 0.03)
        let yOff = -size * CGFloat(0.15 + p * 0.38)
        Text("z")
          .font(.system(size: fontSize, weight: .black, design: .monospaced))
          .foregroundStyle(Color.white.opacity(opacity))
          .offset(x: xOff, y: yOff)
      }
    }
  }

  private func sleepCanvas(t: Double) -> some View {
    let idleTime = t.truncatingRemainder(dividingBy: Self.idleCycleDuration)
    let phase = idleTime / Self.idleCycleDuration
    let float = sin(phase * .pi * 2) * 0.55
    let breathe = sin(phase * .pi * 2 + 0.6)
    let eyeScale = agentIslandMascotLerp([
      (0.0, 1.10),
      (CGFloat(Self.idleSleepStart - 0.18), 1.10),
      (CGFloat(Self.idleSleepStart), 0.0),
      (CGFloat(Self.idleCycleDuration - 0.28), 0.0),
      (CGFloat(Self.idleCycleDuration), 1.10),
    ], at: CGFloat(idleTime))

    return Canvas(rendersAsynchronously: true) { c, sz in
      let v = V(sz)
      drawShadow(c, v: v, width: 8.2 - abs(float) * 0.25, opacity: 0.22)
      drawPululu(
        c,
        v: v,
        dy: float,
        squashX: 1 + breathe * 0.012,
        squashY: 1 - breathe * 0.010,
        eyeScale: eyeScale,
        eyeOpacity: 0.95
      )
    }
  }

  private var workScene: some View {
    timeline(every: 0.03) { t in
      workCanvas(t: t)
    }
  }

  private func workCanvas(t: Double) -> some View {
    let bounce = sin(t * 2 * .pi / 0.38) * 0.75
    let breathe = sin(t * 2 * .pi / 2.6)
    let keyPhase = Int(t / 0.1) % 6
    let blinkPhase = t.truncatingRemainder(dividingBy: 3.2)
    let eyeScale: CGFloat = blinkPhase > 1.15 && blinkPhase < 1.26 ? 0.0 : 1.0
    let headTurn = CGFloat(sin(t * 2 * .pi / 0.86)) * 0.26

    return Canvas(rendersAsynchronously: true) { c, sz in
      let v = V(sz)
      let dy = CGFloat(bounce - 0.25)
      let squashY: CGFloat = dy > 0.25 ? 0.98 : 1.0

      drawShadow(c, v: v, width: 8.1 - abs(dy) * 0.32, opacity: 0.30)
      // 键盘先画：角色要挡在键盘前面，而不是被键盘条横切。
      drawKeyboard(c, v: v, phase: keyPhase, dy: -0.05)
      drawPululu(
        c,
        v: v,
        dy: dy,
        squashX: 1.0 + CGFloat(breathe) * 0.008 + (dy > 0.25 ? 0.018 : 0),
        squashY: squashY,
        eyeScale: eyeScale,
        eyeOpacity: 1,
        eyeYOffset: 0.18,
        eyesBright: true,
        headAngle: headTurn
      )
    }
  }

  private var alertScene: some View {
    let glowActive = alive && animationsActive
    return ZStack {
      Circle()
        .fill(Self.approvalGlowC.opacity(glowActive ? 0.14 : 0))
        .frame(width: size * 0.86)
        .blur(radius: size * 0.06)
        .animation(
          animationsActive ? .easeInOut(duration: 0.48).repeatForever(autoreverses: true) : .default,
          value: glowActive
        )

      timeline(every: 0.03) { t in
        alertCanvas(t: t)
      }
    }
  }

  private func alertCanvas(t: Double) -> some View {
    let cycle = t.truncatingRemainder(dividingBy: 3.5)
    let pct = CGFloat(cycle / 3.5)
    let jumpY = agentIslandMascotLerp([
      (0, 0), (0.03, 0), (0.10, -0.4), (0.15, 0.55),
      (0.175, -3.7), (0.20, -3.7), (0.25, 0.55),
      (0.275, -3.0), (0.30, -3.0), (0.35, 0.45),
      (0.375, -1.9), (0.40, -1.9), (0.45, 0.36),
      (0.475, -1.1), (0.50, -1.1), (0.55, 0.18),
      (0.62, 0), (1, 0),
    ], at: pct)

    let landing = max(0, jumpY)
    let squashX = 1 + landing * 0.08
    let squashY = 1 - landing * 0.05
    let eyeScale: CGFloat = pct > 0.03 && pct < 0.16 ? 1.22 : 1.0
    let shakeX: CGFloat = pct > 0.08 && pct < 0.62 ? sin(pct * .pi * 18) * 0.55 : 0
    let headWobble: CGFloat = pct > 0.08 && pct < 0.62 ? sin(pct * .pi * 16) * 0.23 : 0

    return Canvas(rendersAsynchronously: true) { c, sz in
      let v = V(sz)
      drawShadow(c, v: v, width: 8.4 - abs(min(0, jumpY)) * 0.42, opacity: 0.36)
      var body = c
      body.translateBy(x: shakeX * v.s, y: 0)
      drawPululu(
        body,
        v: v,
        dy: jumpY,
        squashX: squashX,
        squashY: squashY,
        eyeScale: eyeScale,
        eyeOpacity: 1,
        eyeYOffset: pct > 0.03 && pct < 0.16 ? -0.16 : 0,
        eyesBright: true,
        headAngle: headWobble
      )
      drawBang(c, v: v, pct: pct, jumpY: jumpY)
    }
  }

  private var completionScene: some View {
    timeline(every: 0.03) { t in
      completionCanvas(t: t)
    }
  }

  private func completionCanvas(t: Double) -> some View {
    let cycleDuration: Double = 2.05
    let cycle = t.truncatingRemainder(dividingBy: cycleDuration)
    let pct = CGFloat(cycle / cycleDuration)
    let mascotPct = min(1, pct / 0.58)
    let badgePct = max(0, min(1, (pct - 0.54) / 0.46))
    let jumpPhase = mascotPct * 3.0
    let jumpLocal = jumpPhase.truncatingRemainder(dividingBy: 1.0)
    let hop = -sin(jumpLocal * .pi) * (2.05 + mascotPct * 0.55)
    let disappear = agentIslandMascotLerp([
      (0, 1), (0.78, 1), (1, 0),
    ], at: mascotPct)
    let shrink = agentIslandMascotLerp([
      (0, 1), (0.78, 1), (1, 0.18),
    ], at: mascotPct)
    let headNod = sin(Double(jumpPhase) * .pi * 2) * 0.18
    let eyePulse = 1.04 + sin(Double(jumpPhase) * .pi * 2) * 0.07

    return Canvas(rendersAsynchronously: true) { c, sz in
      let v = V(sz)
      if mascotPct < 1 {
        let dy = hop
        drawShadow(c, v: v, width: 8.0 - abs(dy) * 0.36, opacity: 0.26 * Double(disappear))
        var mascot = c
        let center = CGPoint(x: v.ox + 8 * v.s, y: v.oy + 8.15 * v.s)
        mascot.translateBy(x: center.x, y: center.y)
        mascot.scaleBy(x: shrink, y: shrink)
        mascot.translateBy(x: -center.x, y: -center.y)
        mascot.opacity = Double(disappear)
        drawPululu(
          mascot,
          v: v,
          dy: dy,
          squashX: 1.0 + max(0, dy) * 0.035,
          squashY: 1.0 - max(0, dy) * 0.025,
          eyeScale: eyePulse,
          eyeOpacity: 1,
          eyeYOffset: 0.02,
          eyesBright: true,
          headAngle: headNod
        )
      }
      if badgePct > 0 {
        drawCompletionBadge(c, v: v, pct: badgePct)
      }
    }
  }
}

/// Per-skin parameters ported from the Code Island SwiftUI mascot export.
struct SpriteMascotConfig {
  let image: Image?
  let fallbackColor: Color
  let alertColor: Color
  let completionBadgeColor: Color
  let eyeColor: Color
  let approvalGlowColor: Color
  let keyboardBaseColor: Color
  let keyboardKeyColor: Color
  let bodyScale: CGFloat
  let eyeLeftX: CGFloat
  let eyeRightX: CGFloat
  let eyeY: CGFloat
  let eyeRxBase: CGFloat
  let eyeRxClosedAdd: CGFloat
  let eyeRyMin: CGFloat
  let eyeRyOpen: CGFloat
  let eyeRyClosedAdd: CGFloat

  static let tarara = SpriteMascotConfig(
    image: AgentIslandAssets.tararaMascotImage.map { Image(nsImage: $0) },
    fallbackColor: Color(red: 1.0, green: 0.72, blue: 0.20),
    alertColor: Color(red: 0.0, green: 0.85, blue: 0.77),
    completionBadgeColor: Color(red: 0.0, green: 0.85, blue: 0.77),
    eyeColor: Color(red: 0.239, green: 0.447, blue: 0.894),
    approvalGlowColor: Color(red: 0.0, green: 0.85, blue: 0.77),
    keyboardBaseColor: Color(red: 0.00, green: 0.38, blue: 0.34),
    keyboardKeyColor: Color(red: 0.00, green: 0.85, blue: 0.77),
    bodyScale: 1.0,
    eyeLeftX: 6.9,
    eyeRightX: 9.7,
    eyeY: 10.40,
    eyeRxBase: 0.585,
    eyeRxClosedAdd: 0.55,
    eyeRyMin: 0.40,
    eyeRyOpen: 0.98,
    eyeRyClosedAdd: 0.08
  )

  static let boli = SpriteMascotConfig(
    image: AgentIslandAssets.boliMascotImage.map { Image(nsImage: $0) },
    fallbackColor: Color(red: 0.96, green: 0.48, blue: 0.48),
    alertColor: Color(red: 0.949, green: 0.988, blue: 0.463),
    completionBadgeColor: Color(red: 0.620, green: 0.761, blue: 0.961),
    eyeColor: .black,
    approvalGlowColor: Color(red: 0.949, green: 0.988, blue: 0.463),
    keyboardBaseColor: Color(red: 0.16, green: 0.18, blue: 0.23),
    keyboardKeyColor: Color(red: 0.44, green: 0.49, blue: 0.58),
    bodyScale: 0.80,
    eyeLeftX: 5.63,
    eyeRightX: 10.63,
    eyeY: 8.13,
    eyeRxBase: 0.88,
    eyeRxClosedAdd: 0.28,
    eyeRyMin: 0.30,
    eyeRyOpen: 0.88,
    eyeRyClosedAdd: 0.08
  )

  static let whitesnow = SpriteMascotConfig(
    image: AgentIslandAssets.whitesnowMascotImage.map { Image(nsImage: $0) },
    fallbackColor: Color(red: 0.92, green: 0.16, blue: 0.13),
    alertColor: Color(red: 0.976, green: 0.882, blue: 0.345),
    completionBadgeColor: Color(red: 0.569, green: 0.682, blue: 0.373),
    eyeColor: .black,
    approvalGlowColor: Color(red: 0.976, green: 0.882, blue: 0.345),
    keyboardBaseColor: Color(red: 0.16, green: 0.18, blue: 0.23),
    keyboardKeyColor: Color(red: 0.44, green: 0.49, blue: 0.58),
    bodyScale: 1.0,
    eyeLeftX: 6.86,
    eyeRightX: 9.50,
    eyeY: 9.64,
    eyeRxBase: 0.465,
    eyeRxClosedAdd: 0.48,
    eyeRyMin: 0.39,
    eyeRyOpen: 1.02,
    eyeRyClosedAdd: 0.09
  )

  static let annie = SpriteMascotConfig(
    image: AgentIslandAssets.annieMascotImage.map { Image(nsImage: $0) },
    fallbackColor: Color(red: 0.98, green: 0.56, blue: 0.68),
    alertColor: Color(red: 0.992, green: 0.388, blue: 0.549),
    completionBadgeColor: Color(red: 0.467, green: 0.769, blue: 0.918),
    eyeColor: Color(red: 0.682, green: 0.129, blue: 0.275),
    approvalGlowColor: Color(red: 0.992, green: 0.388, blue: 0.549),
    keyboardBaseColor: Color(red: 0.18, green: 0.42, blue: 0.56),
    keyboardKeyColor: Color(red: 0.467, green: 0.769, blue: 0.918),
    bodyScale: 1.0,
    eyeLeftX: 6.31,
    eyeRightX: 9.56,
    eyeY: 11.69,
    eyeRxBase: 0.585,
    eyeRxClosedAdd: 0.55,
    eyeRyMin: 0.40,
    eyeRyOpen: 0.98,
    eyeRyClosedAdd: 0.08
  )

  static let chaku = SpriteMascotConfig(
    image: AgentIslandAssets.chakuMascotImage.map { Image(nsImage: $0) },
    fallbackColor: Color(red: 0.98, green: 0.72, blue: 0.20),
    alertColor: Color(red: 0.992, green: 0.812, blue: 0.271),
    completionBadgeColor: Color(red: 0.129, green: 0.741, blue: 0.682),
    eyeColor: Color(red: 0.992, green: 0.812, blue: 0.271),
    approvalGlowColor: Color(red: 0.992, green: 0.812, blue: 0.271),
    keyboardBaseColor: Color(red: 0.45, green: 0.32, blue: 0.03),
    keyboardKeyColor: Color(red: 0.992, green: 0.812, blue: 0.271),
    bodyScale: 1.0,
    eyeLeftX: 6.19,
    eyeRightX: 9.69,
    eyeY: 9.69,
    eyeRxBase: 0.585,
    eyeRxClosedAdd: 0.55,
    eyeRyMin: 0.40,
    eyeRyOpen: 0.98,
    eyeRyClosedAdd: 0.08
  )

  static let muffin = SpriteMascotConfig(
    image: AgentIslandAssets.muffinMascotImage.map { Image(nsImage: $0) },
    fallbackColor: Color(red: 0.96, green: 0.48, blue: 0.48),
    alertColor: Color(red: 1.0, green: 0.306, blue: 0.192),
    completionBadgeColor: Color(red: 0.490, green: 0.600, blue: 0.835),
    eyeColor: .black,
    approvalGlowColor: Color(red: 1.0, green: 0.306, blue: 0.192),
    keyboardBaseColor: Color(red: 0.19, green: 0.24, blue: 0.38),
    keyboardKeyColor: Color(red: 0.490, green: 0.600, blue: 0.835),
    bodyScale: 1.0,
    eyeLeftX: 5.56,
    eyeRightX: 10.56,
    eyeY: 9.31,
    eyeRxBase: 0.585,
    eyeRxClosedAdd: 0.55,
    eyeRyMin: 0.40,
    eyeRyOpen: 0.98,
    eyeRyClosedAdd: 0.08
  )

  // 以下三个角色的参数来源(2026-07-27)：眼睛几何由「带眼睛版」与「无眼睛版」素材做像素
  // diff 得到 bbox 再换算到 16 单位坐标；眼睛/感叹号/完成徽章的颜色直接取自设计给的色板。
  // 眼睛形状(Rx/Ry/闭眼增量)按设计要求复用 tarara，只有位置和颜色按各自素材实测。

  /// 眼睛：深棕 #6B3D32，形状复用 tarara。
  static let cindy = SpriteMascotConfig(
    image: AgentIslandAssets.cindyMascotImage.map { Image(nsImage: $0) },
    fallbackColor: Color(red: 0.251, green: 0.255, blue: 0.322),
    alertColor: Color(red: 0.875, green: 0.180, blue: 0.153),
    completionBadgeColor: Color(red: 0.404, green: 0.463, blue: 0.941),
    eyeColor: Color(red: 0.420, green: 0.239, blue: 0.196),
    approvalGlowColor: Color(red: 0.875, green: 0.180, blue: 0.153),
    keyboardBaseColor: Color(red: 0.149, green: 0.169, blue: 0.271),
    keyboardKeyColor: Color(red: 0.404, green: 0.463, blue: 0.941),
    bodyScale: 1.0,
    eyeLeftX: 6.71,
    eyeRightX: 9.30,
    eyeY: 9.50,
    eyeRxBase: 0.585,
    eyeRxClosedAdd: 0.55,
    eyeRyMin: 0.40,
    eyeRyOpen: 0.98,
    eyeRyClosedAdd: 0.08
  )

  /// 眼睛：黄色 #FDCF45，形状复用 tarara(与 chaku 同一套)。
  /// 位置不用带眼版素材的实测值(6.25/9.75/9.50)：那版素材的眼睛只有 0.76 宽，换成 tarara
  /// 的 1.17 宽眼型后同样间距会显挤、重心偏低，所以外移到间距 4.10 并上提到 9.05。
  static let blackcat = SpriteMascotConfig(
    image: AgentIslandAssets.blackcatMascotImage.map { Image(nsImage: $0) },
    fallbackColor: Color(red: 0.169, green: 0.196, blue: 0.220),
    alertColor: Color(red: 0.875, green: 0.180, blue: 0.153),
    completionBadgeColor: Color(red: 0.404, green: 0.463, blue: 0.941),
    eyeColor: Color(red: 0.992, green: 0.812, blue: 0.271),
    approvalGlowColor: Color(red: 0.875, green: 0.180, blue: 0.153),
    keyboardBaseColor: Color(red: 0.122, green: 0.141, blue: 0.161),
    keyboardKeyColor: Color(red: 0.404, green: 0.463, blue: 0.941),
    bodyScale: 1.0,
    eyeLeftX: 5.95,
    eyeRightX: 10.05,
    eyeY: 9.05,
    eyeRxBase: 0.585,
    eyeRxClosedAdd: 0.55,
    eyeRyMin: 0.40,
    eyeRyOpen: 0.98,
    eyeRyClosedAdd: 0.08
  )

  /// 眼睛：棕 #875D42，形状复用 tarara；眼位比 cindy 更低。
  static let erika = SpriteMascotConfig(
    image: AgentIslandAssets.erikaMascotImage.map { Image(nsImage: $0) },
    fallbackColor: Color(red: 0.329, green: 0.302, blue: 0.337),
    alertColor: Color(red: 0.953, green: 0.796, blue: 0.314),
    completionBadgeColor: Color(red: 0.353, green: 0.612, blue: 0.667),
    eyeColor: Color(red: 0.529, green: 0.365, blue: 0.259),
    approvalGlowColor: Color(red: 0.953, green: 0.796, blue: 0.314),
    keyboardBaseColor: Color(red: 0.200, green: 0.278, blue: 0.302),
    keyboardKeyColor: Color(red: 0.353, green: 0.612, blue: 0.667),
    bodyScale: 1.0,
    eyeLeftX: 6.84,
    eyeRightX: 9.16,
    eyeY: 10.75,
    eyeRxBase: 0.585,
    eyeRxClosedAdd: 0.55,
    eyeRyMin: 0.40,
    eyeRyOpen: 0.98,
    eyeRyClosedAdd: 0.08
  )

  /// 眼睛几何由派蒙徽章图实测(128px 身体 → 16 单位坐标)；眼睛色取虹膜蓝，
  /// 金色系取自头顶光环。身体 PNG 已去原画眼睛，与动画 overlay 眼睛同位。
  static let paimon = SpriteMascotConfig(
    image: AgentIslandAssets.paimonMascotImage.map { Image(nsImage: $0) },
    fallbackColor: Color(red: 0.96, green: 0.94, blue: 0.91),
    alertColor: Color(red: 0.91, green: 0.69, blue: 0.29),
    completionBadgeColor: Color(red: 0.91, green: 0.69, blue: 0.29),
    eyeColor: Color(red: 0.259, green: 0.451, blue: 0.655),
    approvalGlowColor: Color(red: 0.91, green: 0.69, blue: 0.29),
    keyboardBaseColor: Color(red: 0.14, green: 0.16, blue: 0.30),
    keyboardKeyColor: Color(red: 0.91, green: 0.69, blue: 0.29),
    bodyScale: 1.0,
    eyeLeftX: 6.06,
    eyeRightX: 9.88,
    eyeY: 9.44,
    eyeRxBase: 0.70,
    eyeRxClosedAdd: 0.45,
    eyeRyMin: 0.35,
    eyeRyOpen: 1.00,
    eyeRyClosedAdd: 0.08
  )
}

/// 灵动岛角色清单与查表：新增角色时只改这里(加 `skins` 条目 + `spriteConfig` 分支)，
/// 运行时渲染和 `preview:island-mascots` 预览网格都会自动覆盖新角色。
/// `skins` 必须与 `src/features/island/agent-island-shared.ts` 的 `AGENT_ISLAND_MASCOT_SKINS` 保持一致。
enum AgentIslandMascotCatalog {
  /// 顺序与 `src/features/island/agent-island-shared.ts` 的 `AGENT_ISLAND_MASCOT_SKINS` 一致
  /// (也就是设置页列表的展示顺序)，预览网格同样按这个顺序铺。
  static let skins: [String] = [
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
    "paimon",
  ]

  /// PNG 贴图角色的渲染参数；返回 nil 表示该皮肤走矢量绘制(pululu)。
  static func spriteConfig(for skin: String) -> SpriteMascotConfig? {
    switch skin {
    case "tarara": return .tarara
    case "boli": return .boli
    case "whitesnow": return .whitesnow
    case "annie": return .annie
    case "chaku": return .chaku
    case "muffin": return .muffin
    case "cindy": return .cindy
    case "blackcat": return .blackcat
    case "erika": return .erika
    case "paimon": return .paimon
    default: return nil
    }
  }
}

/// Runtime mascot renderer for PNG-backed skins with shared animation timing.
struct SpriteMascotView: View {
  let size: CGFloat
  let state: AgentIslandMascotAnimationState
  let config: SpriteMascotConfig
  @State private var alive = false
  @State private var timelineStart = Date().timeIntervalSinceReferenceDate
  @Environment(\.agentIslandMascotAnimationsActive) private var animationsActive
  @Environment(\.agentIslandMascotAnimationEpoch) private var animationEpoch
  private static let keyboardHighlightColor = Color.white
  private static let idleCycleDuration: Double = 4.9
  private static let idleSleepStart: Double = 1.15

  var body: some View {
    ZStack {
      switch state {
      case .idle:
        sleepScene
      case .working:
        workScene
      case .waitingApproval:
        alertScene
      case .completed:
        completionScene
      }
    }
    .frame(width: size, height: size)
    .clipped()
    .onAppear {
      restartTimeline()
    }
    .onChange(of: state) { _, _ in
      restartTimeline()
    }
    .onChange(of: animationEpoch) { _, _ in
      restartTimeline()
    }
  }

  @ViewBuilder
  private func timeline<Content: View>(
    every interval: TimeInterval,
    staticTime: Double = 0,
    @ViewBuilder content: @escaping (Double) -> Content
  ) -> some View {
    if animationsActive {
      TimelineView(.periodic(from: .now, by: interval)) { ctx in
        content(ctx.date.timeIntervalSinceReferenceDate - timelineStart)
      }
      .id(animationEpoch)
    } else {
      content(staticTime)
    }
  }

  private func restartTimeline() {
    alive = false
    timelineStart = Date().timeIntervalSinceReferenceDate
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
      alive = true
    }
  }

  private struct V {
    let ox: CGFloat
    let oy: CGFloat
    let s: CGFloat

    init(_ sz: CGSize, w: CGFloat = 16, h: CGFloat = 16) {
      s = min(sz.width / w, sz.height / h)
      ox = (sz.width - w * s) / 2
      oy = (sz.height - h * s) / 2
    }

    func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, dy: CGFloat = 0) -> CGRect {
      CGRect(x: ox + x * s, y: oy + (y + dy) * s, width: w * s, height: h * s)
    }

    func ellipse(cx: CGFloat, cy: CGFloat, rx: CGFloat, ry: CGFloat? = nil, dy: CGFloat = 0) -> CGRect {
      let ey = ry ?? rx
      return rect(cx - rx, cy - ey, rx * 2, ey * 2, dy: dy)
    }

    func point(_ x: CGFloat, _ y: CGFloat, dy: CGFloat = 0) -> CGPoint {
      CGPoint(x: ox + x * s, y: oy + (y + dy) * s)
    }
  }

  private func rounded(_ rect: CGRect, radius: CGFloat) -> Path {
    Path(roundedRect: rect, cornerRadius: radius)
  }

  private func drawShadow(_ c: GraphicsContext, v: V, width: CGFloat, opacity: Double, dy: CGFloat = 0) {
    c.fill(
      Path(ellipseIn: v.ellipse(cx: 8, cy: 14.3, rx: width / 2, ry: 0.48, dy: dy)),
      with: .color(.black.opacity(opacity))
    )
  }

  private func drawSprite(
    _ c: GraphicsContext,
    v: V,
    dy: CGFloat = 0,
    x: CGFloat = 0,
    scaleX: CGFloat = 1,
    scaleY: CGFloat = 1,
    opacity: Double = 1,
    eyeScale: CGFloat = 1,
    eyeOpacity: Double = 1,
    eyeYOffset: CGFloat = 0,
    angle: CGFloat = 0
  ) {
    var sprite = c
    let center = v.point(8 + x, 8.1, dy: dy)
    sprite.translateBy(x: center.x, y: center.y)
    sprite.rotate(by: .radians(Double(angle)))
    sprite.scaleBy(x: scaleX * config.bodyScale, y: scaleY * config.bodyScale)
    sprite.translateBy(x: -center.x, y: -center.y)
    sprite.opacity = opacity

    if let image = config.image {
      sprite.draw(image, in: v.rect(x, 0, 16, 16, dy: dy))
    } else {
      sprite.fill(
        Path(ellipseIn: v.ellipse(cx: 8 + x, cy: 8.1, rx: 5.8, ry: 5.8, dy: dy)),
        with: .color(config.fallbackColor)
      )
    }
    drawEyes(sprite, v: v, dy: dy + eyeYOffset, x: x, scale: eyeScale, opacity: eyeOpacity)
  }

  private func drawEyes(
    _ c: GraphicsContext,
    v: V,
    dy: CGFloat,
    x: CGFloat,
    scale: CGFloat,
    opacity: Double
  ) {
    let openness = scale < 0.25 ? 0 : min(scale, 1.18)
    let closed = 1 - min(openness, 1)
    let rx = config.eyeRxBase + config.eyeRxClosedAdd * closed
    let ry = max(config.eyeRyMin, config.eyeRyOpen * openness + config.eyeRyClosedAdd * closed)
    let cy = config.eyeY
    c.fill(
      Path(ellipseIn: v.ellipse(cx: config.eyeLeftX + x, cy: cy, rx: rx, ry: ry, dy: dy)),
      with: .color(config.eyeColor.opacity(opacity))
    )
    c.fill(
      Path(ellipseIn: v.ellipse(cx: config.eyeRightX + x, cy: cy, rx: rx, ry: ry, dy: dy)),
      with: .color(config.eyeColor.opacity(opacity))
    )
  }

  private func drawKeyboard(_ c: GraphicsContext, v: V, phase: Int, dy: CGFloat) {
    c.fill(Path(v.rect(0.5, 13.0, 15, 3, dy: dy)), with: .color(config.keyboardBaseColor))
    for row in 0..<2 {
      let ky = 13.5 + CGFloat(row) * 1.2
      for col in 0..<6 {
        let kx = 1.0 + CGFloat(col) * 2.4
        c.fill(Path(v.rect(kx, ky, 1.8, 0.7, dy: dy)), with: .color(config.keyboardKeyColor))
      }
    }
    c.fill(
      Path(v.rect(1.0 + CGFloat(phase % 6) * 2.4, 13.5 + CGFloat(phase / 3) * 1.2, 1.8, 0.7, dy: dy)),
      with: .color(Self.keyboardHighlightColor.opacity(0.9))
    )
  }

  private func drawBang(_ c: GraphicsContext, v: V, pct: CGFloat, jumpY: CGFloat) {
    let opacity = agentIslandMascotLerp([
      (0, 0), (0.03, 1), (0.10, 1), (0.55, 1), (0.62, 0), (1, 0),
    ], at: pct)
    guard opacity > 0.01 else { return }
    let scale = agentIslandMascotLerp([
      (0, 0.3), (0.03, 1.3), (0.10, 1.0), (0.55, 1.0), (0.62, 0.6), (1, 0.6),
    ], at: pct)
    let bw: CGFloat = 1.65 * scale
    let bx: CGFloat = 13
    let by: CGFloat = 1.0 + jumpY * 0.15
    c.fill(
      rounded(v.rect(bx, by, bw, 3.5 * scale), radius: bw * v.s * 0.45),
      with: .color(config.alertColor.opacity(Double(opacity)))
    )
    c.fill(
      rounded(v.rect(bx, by + 4.05 * scale, bw, 1.45 * scale), radius: bw * v.s * 0.45),
      with: .color(config.alertColor.opacity(Double(opacity)))
    )
  }

  private func drawCompletionBadge(_ c: GraphicsContext, v: V, pct: CGFloat) {
    let fade = pct < 0.92 ? 1.0 : max(0, (1.0 - pct) / 0.08)
    let badgeScale = agentIslandMascotLerp([
      (0, 0.15), (0.10, 1.20), (0.20, 0.94),
      (0.32, 1.0), (0.92, 1.0), (1, 0.90),
    ], at: pct)
    let cx: CGFloat = 8
    let cy: CGFloat = 8.05
    let badgeR: CGFloat = 5.95 * badgeScale

    c.fill(
      Path(ellipseIn: v.ellipse(cx: cx, cy: cy, rx: badgeR, ry: badgeR)),
      with: .color(config.completionBadgeColor.opacity(Double(fade)))
    )
    c.fill(
      Path(ellipseIn: v.ellipse(
        cx: cx - 1.55 * badgeScale,
        cy: cy - 1.85 * badgeScale,
        rx: 1.08 * badgeScale,
        ry: 0.55 * badgeScale
      )),
      with: .color(Color.white.opacity(Double(0.25 * fade)))
    )

    var check = Path()
    check.move(to: CGPoint(x: v.ox + (cx - 2.38 * badgeScale) * v.s, y: v.oy + (cy + 0.18 * badgeScale) * v.s))
    check.addLine(to: CGPoint(x: v.ox + (cx - 0.62 * badgeScale) * v.s, y: v.oy + (cy + 1.86 * badgeScale) * v.s))
    check.addLine(to: CGPoint(x: v.ox + (cx + 2.92 * badgeScale) * v.s, y: v.oy + (cy - 2.10 * badgeScale) * v.s))
    c.stroke(
      check,
      with: .color(Color.white.opacity(Double(fade))),
      style: StrokeStyle(lineWidth: 1.10 * badgeScale * v.s, lineCap: .round, lineJoin: .round)
    )
  }

  private var sleepScene: some View {
    ZStack {
      timeline(every: 0.06) { t in
        sleepCanvas(t: t)
      }
      timeline(every: 0.05) { t in
        floatingZs(t: t)
      }
    }
  }

  private func floatingZs(t: Double) -> some View {
    ZStack {
      ForEach(0..<3, id: \.self) { i in
        let ci = Double(i)
        let idleTime = t.truncatingRemainder(dividingBy: Self.idleCycleDuration)
        let sleepElapsed = idleTime - Self.idleSleepStart
        let cycle = 2.8 + ci * 0.3
        let delay = ci * 0.9
        let localT = sleepElapsed - delay
        let phase = localT >= 0 ? (localT.truncatingRemainder(dividingBy: cycle)) / cycle : 0
        let p = max(0, phase)
        let fontSize = max(6, size * CGFloat(0.18 + p * 0.10))
        let baseOpacity = 0.74 - ci * 0.1
        let sleepOpacity = sleepElapsed >= delay ? 1.0 : 0.0
        let opacity = sleepOpacity * (p < 0.8 ? baseOpacity : (1.0 - p) * 3.5 * baseOpacity)
        let xOff = size * CGFloat(0.10 + ci * 0.05 + sin(p * .pi * 2) * 0.03)
        let yOff = -size * CGFloat(0.16 + p * 0.38)
        Text("z")
          .font(.system(size: fontSize, weight: .black, design: .monospaced))
          .foregroundStyle(Color.white.opacity(opacity))
          .offset(x: xOff, y: yOff)
      }
    }
  }

  private func sleepCanvas(t: Double) -> some View {
    let idleTime = t.truncatingRemainder(dividingBy: Self.idleCycleDuration)
    let phase = idleTime / Self.idleCycleDuration
    let float = sin(phase * .pi * 2) * 0.42
    let breathe = sin(phase * .pi * 2 + 0.6)
    let eyeScale = agentIslandMascotLerp([
      (0.0, 1.08),
      (CGFloat(Self.idleSleepStart - 0.18), 1.08),
      (CGFloat(Self.idleSleepStart), 0.0),
      (CGFloat(Self.idleCycleDuration - 0.28), 0.0),
      (CGFloat(Self.idleCycleDuration), 1.08),
    ], at: CGFloat(idleTime))

    return Canvas(rendersAsynchronously: true) { c, sz in
      let v = V(sz)
      drawShadow(c, v: v, width: 8.8 - abs(float) * 0.22, opacity: 0.23)
      drawSprite(
        c,
        v: v,
        dy: float,
        scaleX: 1 + breathe * 0.012,
        scaleY: 1 - breathe * 0.010,
        eyeScale: eyeScale,
        eyeOpacity: 0.96,
        angle: CGFloat(breathe) * 0.04
      )
    }
  }

  private var workScene: some View {
    timeline(every: 0.03) { t in
      workCanvas(t: t)
    }
  }

  private func workCanvas(t: Double) -> some View {
    let bounce = sin(t * 2 * .pi / 0.38) * 0.72
    let breathe = sin(t * 2 * .pi / 2.5)
    let keyPhase = Int(t / 0.1) % 6
    let blinkPhase = t.truncatingRemainder(dividingBy: 3.1)
    let eyeScale: CGFloat = blinkPhase > 1.12 && blinkPhase < 1.23 ? 0.0 : 1.0
    let headTurn = CGFloat(sin(t * 2 * .pi / 0.84)) * 0.22
    let xShift = CGFloat(sin(t * 2 * .pi / 0.72)) * 0.18

    return Canvas(rendersAsynchronously: true) { c, sz in
      let v = V(sz)
      let dy = bounce - 0.25
      drawShadow(c, v: v, width: 8.4 - abs(dy) * 0.32, opacity: 0.30)
      // 键盘先画：角色要挡在键盘前面，而不是被键盘条横切。
      drawKeyboard(c, v: v, phase: keyPhase, dy: -0.05)
      drawSprite(
        c,
        v: v,
        dy: dy,
        x: xShift,
        scaleX: 1.0 + breathe * 0.008 + (dy > 0.25 ? 0.018 : 0),
        scaleY: dy > 0.25 ? 0.98 : 1.0,
        eyeScale: eyeScale,
        eyeOpacity: 1,
        eyeYOffset: 0.05,
        angle: headTurn
      )
    }
  }

  private var alertScene: some View {
    let glowActive = alive && animationsActive
    return ZStack {
      Circle()
        .fill(config.approvalGlowColor.opacity(glowActive ? 0.12 : 0))
        .frame(width: size * 0.92)
        .blur(radius: size * 0.06)
        .animation(
          animationsActive ? .easeInOut(duration: 0.48).repeatForever(autoreverses: true) : .default,
          value: glowActive
        )

      timeline(every: 0.03) { t in
        alertCanvas(t: t)
      }
    }
  }

  private func alertCanvas(t: Double) -> some View {
    let cycle = t.truncatingRemainder(dividingBy: 3.5)
    let pct = CGFloat(cycle / 3.5)
    let jumpY = agentIslandMascotLerp([
      (0, 0), (0.03, 0), (0.10, -0.4), (0.15, 0.55),
      (0.175, -3.7), (0.20, -3.7), (0.25, 0.55),
      (0.275, -3.0), (0.30, -3.0), (0.35, 0.45),
      (0.375, -1.9), (0.40, -1.9), (0.45, 0.36),
      (0.475, -1.1), (0.50, -1.1), (0.55, 0.18),
      (0.62, 0), (1, 0),
    ], at: pct)
    let landing = max(0, jumpY)
    let eyeScale: CGFloat = pct > 0.03 && pct < 0.16 ? 1.16 : 1.0
    let shakeX: CGFloat = pct > 0.08 && pct < 0.62 ? sin(pct * .pi * 18) * 0.55 : 0
    let headWobble: CGFloat = pct > 0.08 && pct < 0.62 ? sin(pct * .pi * 16) * 0.20 : 0

    return Canvas(rendersAsynchronously: true) { c, sz in
      let v = V(sz)
      drawShadow(c, v: v, width: 8.6 - abs(min(0, jumpY)) * 0.42, opacity: 0.36)
      drawSprite(
        c,
        v: v,
        dy: jumpY,
        x: shakeX,
        scaleX: 1 + landing * 0.08,
        scaleY: 1 - landing * 0.05,
        eyeScale: eyeScale,
        eyeOpacity: 1,
        eyeYOffset: pct > 0.03 && pct < 0.16 ? -0.12 : 0,
        angle: headWobble
      )
      drawBang(c, v: v, pct: pct, jumpY: jumpY)
    }
  }

  private var completionScene: some View {
    timeline(every: 0.03) { t in
      completionCanvas(t: t)
    }
  }

  private func completionCanvas(t: Double) -> some View {
    let cycleDuration: Double = 2.05
    let cycle = t.truncatingRemainder(dividingBy: cycleDuration)
    let pct = CGFloat(cycle / cycleDuration)
    let mascotPct = min(1, pct / 0.58)
    let badgePct = max(0, min(1, (pct - 0.54) / 0.46))
    let jumpPhase = mascotPct * 3.0
    let jumpLocal = jumpPhase.truncatingRemainder(dividingBy: 1.0)
    let hop = -sin(jumpLocal * .pi) * (2.05 + mascotPct * 0.55)
    let disappear = agentIslandMascotLerp([(0, 1), (0.78, 1), (1, 0)], at: mascotPct)
    let shrink = agentIslandMascotLerp([(0, 1), (0.78, 1), (1, 0.18)], at: mascotPct)
    let headNod = CGFloat(sin(Double(jumpPhase) * .pi * 2) * 0.18)
    let eyePulse = 1.04 + CGFloat(sin(Double(jumpPhase) * .pi * 2)) * 0.07

    return Canvas(rendersAsynchronously: true) { c, sz in
      let v = V(sz)
      if mascotPct < 1 {
        let dy = hop
        drawShadow(c, v: v, width: 8.4 - abs(dy) * 0.36, opacity: 0.26 * Double(disappear))
        drawSprite(
          c,
          v: v,
          dy: dy,
          scaleX: shrink * (1.0 + max(0, dy) * 0.035),
          scaleY: shrink * (1.0 - max(0, dy) * 0.025),
          opacity: Double(disappear),
          eyeScale: eyePulse,
          eyeOpacity: 1,
          eyeYOffset: 0.02,
          angle: headNod
        )
      }
      if badgePct > 0 {
        drawCompletionBadge(c, v: v, pct: badgePct)
      }
    }
  }
}


struct AgentIslandActivityLine: Codable, Equatable, Identifiable {
  let id: String
  let kind: String
  let text: String
}

struct AgentIslandPermissionAction: Codable, Equatable {
  let requestId: String
  let canAllowForSession: Bool
}

struct AgentIslandSession: Codable, Equatable, Identifiable {
  let sessionId: String
  let title: String
  let projectName: String?
  let detail: String
  let compactDetail: String
  let messagePreview: AgentIslandActivityLine?
  let phase: String
  let agentKind: String
  let interactionKind: String?
  let permissionAction: AgentIslandPermissionAction?
  let attention: Bool
  let activityLines: [AgentIslandActivityLine]
  let startedAt: Double
  let lastActivityAt: Double

  var id: String { sessionId }
  var displayTitle: String { title.isEmpty ? (projectName ?? title) : title }
  var subtitle: String { compactDetail }
}


struct AgentIslandStrings: Codable, Equatable {
  let appName: String?
  let newConversationTitle: String
  let newConversationHint: String
  let muteSound: String
  let enableSound: String
  let settings: String
  let newMessage: String
  let review: String
  let needsInput: String
  let completed: String
  let error: String
  let input: String
  let done: String
  let running: String
  // 等待交互摘要(按 interactionKind 出人话;与 app 侧栏卡片 awaiting* 文案一致)
  let awaitingPermission: String
  let awaitingQuestion: String
  let awaitingPlan: String
  let permissionPromptTitle: String
  let allowOnce: String
  let alwaysAllowForSession: String
  let deny: String

  // Older main-process payloads do not contain appName; keep their idle view brand-current.
  var displayAppName: String { appName ?? "Paimon" }

  static let fallback = AgentIslandStrings(
    appName: "Paimon",
    newConversationTitle: "New Session",
    newConversationHint: "Start a new session",
    muteSound: "Mute task sounds",
    enableSound: "Enable task sounds",
    settings: "Menu bar settings",
    newMessage: "New message",
    review: "Review",
    needsInput: "Needs input",
    completed: "Completed",
    error: "Error",
    input: "Input",
    done: "Done",
    running: "Running",
    awaitingPermission: "Awaiting permission",
    awaitingQuestion: "Awaiting your reply",
    awaitingPlan: "Awaiting plan review",
    permissionPromptTitle: "Confirm permission",
    allowOnce: "Allow once",
    alwaysAllowForSession: "Always allow",
    deny: "Deny"
  )
}

struct AgentIslandSoundSettings: Codable {
  let enabled: Bool
  let sounds: [String: AgentIslandSoundChoice]

  static let fallback = AgentIslandSoundSettings(
    enabled: true,
    sounds: [
      "start": .builtin("startup-chime"),
      "attention": .builtin("secret-chime"),
      "complete": .builtin("gem-collect"),
      "error": .builtin("error-buzz"),
      "select": .builtin("none"),
    ]
  )
}

enum AgentIslandSoundChoice: Codable {
  case builtin(String)
  case custom(path: String, name: String)

  private enum CodingKeys: String, CodingKey {
    case type
    case id
    case path
    case name
  }

  init(from decoder: Decoder) throws {
    if let container = try? decoder.singleValueContainer(),
       let soundId = try? container.decode(String.self)
    {
      self = .builtin(soundId)
      return
    }
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let type = try container.decode(String.self, forKey: .type)
    switch type {
    case "custom":
      let path = try container.decode(String.self, forKey: .path)
      let name = try container.decodeIfPresent(String.self, forKey: .name) ?? URL(fileURLWithPath: path).lastPathComponent
      self = .custom(path: path, name: name)
    default:
      let soundId = try container.decode(String.self, forKey: .id)
      self = .builtin(soundId)
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .builtin(let soundId):
      try container.encode("builtin", forKey: .type)
      try container.encode(soundId, forKey: .id)
    case .custom(let path, let name):
      try container.encode("custom", forKey: .type)
      try container.encode(path, forKey: .path)
      try container.encode(name, forKey: .name)
    }
  }
}


private let agentIslandOrange = Color(red: 1.0, green: 0.4, blue: 0.0)
private let agentIslandBlue = Color(red: 0.0, green: 0.851, blue: 0.773)
private let agentIslandErrorRed = Color(red: 0.937, green: 0.267, blue: 0.267)
private let agentIslandUnreadGreen = Color(red: 0.133, green: 0.773, blue: 0.369)
private let runningAgentGifFileName = "running-agent.gif"
private let tararaMascotFileName = "tarara.png"
private let boliMascotFileName = "boli.png"
private let whitesnowMascotFileName = "whitesnow.png"
private let annieMascotFileName = "annie.png"
private let chakuMascotFileName = "chaku.png"
private let muffinMascotFileName = "muffin.png"
private let cindyMascotFileName = "cindy.png"
private let blackcatMascotFileName = "blackcat.png"
private let erikaMascotFileName = "erika.png"
private let paimonMascotFileName = "paimon.png"
private let defaultAgentIslandMascotSkin = "paimon"
// Keep these mono Agent identity marks aligned with renderer ClaudeMark/CodexMark.
// The native copies remain template images so Agent Island can apply status colors.
private let agentIslandCodexMarkSVG = """
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <g transform="translate(12 12) scale(1.1) translate(-12 -12)">
    <path fill="none" stroke="black" stroke-width="2" stroke-linejoin="round" d="M9.064 3.344a4.6 4.6 0 0 1 2.285-.312q1.5.173 2.673 1.275.016.015.037.021a.1.1 0 0 0 .043 0 4.55 4.55 0 0 1 3.046.275l.047.022.116.057a4.58 4.58 0 0 1 2.188 2.399q.313.765.315 1.595a4.2 4.2 0 0 1-.134 1.223.12.12 0 0 0 .03.115q.89.91 1.183 2.17.433 2.138-.887 3.854l-.136.166a4.55 4.55 0 0 1-2.201 1.388.12.12 0 0 0-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838q-1.78-.009-3.157-1.302a.11.11 0 0 0-.105-.024c-.388.125-.78.143-1.204.138a4.44 4.44 0 0 1-1.945-.466 4.54 4.54 0 0 1-1.61-1.335c-.152-.202-.303-.392-.414-.617a6 6 0 0 1-.37-.961 4.6 4.6 0 0 1-.014-2.298.1.1 0 0 0 .006-.056.1.1 0 0 0-.027-.048 4.5 4.5 0 0 1-1.034-1.651 3.9 3.9 0 0 1-.251-1.192 5.2 5.2 0 0 1 .141-1.6Q3.659 7.92 5.086 6.97q.318-.212.601-.33a6 6 0 0 1 .646-.227.1.1 0 0 0 .065-.066 4.5 4.5 0 0 1 .829-1.615 4.54 4.54 0 0 1 1.837-1.388z"/>
    <path fill="black" stroke="black" stroke-width="0.5" stroke-linejoin="round" d="M12.546 13.909a.637.637 0 0 0 0 1.272h3.636a.637.637 0 1 0 0-1.272zM8.462 9.23a.637.637 0 0 0-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 1 0 1.095.649l1.454-2.455a.64.64 0 0 0 .005-.64z"/>
  </g>
</svg>
"""
private let agentIslandClaudeMarkSVG = """
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <path fill="black" fill-rule="evenodd" clip-rule="evenodd" d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0v-3.1h3V5h17.998zM6 10.949h1.488V8.102H6zm10.51 0H18V8.102h-1.49z"/>
</svg>
"""


private enum AgentIslandAssets {
  static let runningAgentGifImage: NSImage? = {
    for url in runningAgentGifCandidateURLs() {
      if let image = NSImage(contentsOf: url) {
        image.size = NSSize(width: 128, height: 128)
        return image
      }
    }
    return nil
  }()

  static let tararaMascotImage: NSImage? = {
    mascotImage(fileName: tararaMascotFileName, size: NSSize(width: 128, height: 128))
  }()

  static let boliMascotImage: NSImage? = {
    mascotImage(fileName: boliMascotFileName, size: NSSize(width: 128, height: 128))
  }()

  static let whitesnowMascotImage: NSImage? = {
    mascotImage(fileName: whitesnowMascotFileName, size: NSSize(width: 134, height: 134))
  }()

  static let annieMascotImage: NSImage? = {
    mascotImage(fileName: annieMascotFileName, size: NSSize(width: 128, height: 128))
  }()

  static let chakuMascotImage: NSImage? = {
    mascotImage(fileName: chakuMascotFileName, size: NSSize(width: 128, height: 128))
  }()

  static let muffinMascotImage: NSImage? = {
    mascotImage(fileName: muffinMascotFileName, size: NSSize(width: 128, height: 128))
  }()

  static let cindyMascotImage: NSImage? = {
    mascotImage(fileName: cindyMascotFileName, size: NSSize(width: 128, height: 128))
  }()

  static let blackcatMascotImage: NSImage? = {
    mascotImage(fileName: blackcatMascotFileName, size: NSSize(width: 128, height: 128))
  }()

  static let erikaMascotImage: NSImage? = {
    mascotImage(fileName: erikaMascotFileName, size: NSSize(width: 128, height: 128))
  }()

  static let paimonMascotImage: NSImage? = {
    mascotImage(fileName: paimonMascotFileName, size: NSSize(width: 128, height: 128))
  }()

  private static func runningAgentGifCandidateURLs() -> [URL] {
    var urls: [URL] = []
    let environment = ProcessInfo.processInfo.environment
    if let assetDir = environment["XDT_AGENT_ISLAND_ASSET_DIR"], !assetDir.isEmpty {
      urls.append(URL(fileURLWithPath: assetDir).appendingPathComponent(runningAgentGifFileName))
    }
    if let executablePath = CommandLine.arguments.first, !executablePath.isEmpty {
      urls.append(
        URL(fileURLWithPath: executablePath)
          .deletingLastPathComponent()
          .appendingPathComponent(runningAgentGifFileName)
      )
    }
    urls.append(
      URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        .appendingPathComponent("apps")
        .appendingPathComponent("desktop")
        .appendingPathComponent("native")
        .appendingPathComponent("agent-island")
        .appendingPathComponent(runningAgentGifFileName)
    )
    return urls
  }

  private static func mascotImage(fileName: String, size: NSSize) -> NSImage? {
    for url in mascotCandidateURLs(fileName: fileName) {
      if let image = NSImage(contentsOf: url) {
        image.size = size
        return image
      }
    }
    return nil
  }

  private static func mascotCandidateURLs(fileName: String) -> [URL] {
    var urls: [URL] = []
    let environment = ProcessInfo.processInfo.environment
    if let assetDir = environment["XDT_AGENT_ISLAND_ASSET_DIR"], !assetDir.isEmpty {
      urls.append(
        URL(fileURLWithPath: assetDir)
          .appendingPathComponent("mascots", isDirectory: true)
          .appendingPathComponent(fileName)
      )
    }
    if let executablePath = CommandLine.arguments.first, !executablePath.isEmpty {
      urls.append(
        URL(fileURLWithPath: executablePath)
          .deletingLastPathComponent()
          .appendingPathComponent("mascots", isDirectory: true)
          .appendingPathComponent(fileName)
      )
    }
    urls.append(
      URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        .appendingPathComponent("apps")
        .appendingPathComponent("desktop")
        .appendingPathComponent("native")
        .appendingPathComponent("agent-island")
        .appendingPathComponent("mascots", isDirectory: true)
        .appendingPathComponent(fileName)
    )
    return urls
  }
}


struct ExpandedRowSummary {
  let prefix: String
  let text: String
  let accent: Color
  let isUser: Bool
}

func expandedPrimaryTitle(for session: AgentIslandSession, strings: AgentIslandStrings) -> String {
  if session.permissionAction != nil {
    return strings.permissionPromptTitle
  }
  let title = session.title.trimmingCharacters(in: .whitespacesAndNewlines)
  if isMeaningfulExpandedTitle(title) {
    return title
  }
  let project = session.projectName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  if !project.isEmpty {
    return project
  }
  return "#\(String(session.sessionId.prefix(8)))"
}

func isMeaningfulExpandedTitle(_ title: String) -> Bool {
  if title.isEmpty { return false }
  let normalized = title.lowercased()
  return normalized != "new maker"
    && normalized != "untitled"
    && normalized != "codex"
    && normalized != "claude"
    && normalized != "claude code"
    && normalized != "agent"
}

func sessionIdentityColor(for session: AgentIslandSession) -> Color {
  switch session.phase {
  case "running":
    return agentIslandOrange
  case "needs-interaction":
    return agentIslandBlue
  case "error":
    return agentIslandErrorRed
  default:
    return Color.white.opacity(0.92)
  }
}

func statusAccentColor(for session: AgentIslandSession) -> Color {
  switch session.phase {
  case "running":
    return agentIslandOrange
  case "needs-interaction":
    return agentIslandBlue
  case "error":
    return agentIslandErrorRed
  default:
    return Color.white.opacity(0.68)
  }
}

func expandedRowSummary(for session: AgentIslandSession, strings: AgentIslandStrings) -> ExpandedRowSummary {
  switch session.phase {
  case "needs-interaction":
    return ExpandedRowSummary(
      prefix: session.permissionAction == nil ? "!" : "?",
      text: bestInteractionSummary(for: session, strings: strings),
      accent: agentIslandBlue,
      isUser: false
    )
  case "completed":
    if let preview = messagePreviewSummary(for: session) {
      return preview
    }
    return ExpandedRowSummary(
      prefix: "",
      text: bestCompletedSummary(for: session, strings: strings),
      accent: Color.white.opacity(0.72),
      isUser: false
    )
  case "error":
    return ExpandedRowSummary(
      prefix: "!",
      text: bestErrorSummary(for: session, strings: strings),
      accent: agentIslandErrorRed,
      isUser: false
    )
  default:
    return bestRunningSummary(for: session, strings: strings)
  }
}

func bestRunningSummary(for session: AgentIslandSession, strings: AgentIslandStrings) -> ExpandedRowSummary {
  if let preview = messagePreviewSummary(for: session) {
    return preview
  }

  let detail = stripLeadingPromptSymbol(session.detail)
  if !detail.isEmpty && !isGenericRunningStatusDetail(detail) {
    return ExpandedRowSummary(
      prefix: "$",
      text: detail,
      accent: statusAccentColor(for: session),
      isUser: false
    )
  }
  if let line = latestActivityLine(for: session, kinds: ["assistant", "status", "tool"]) {
    return ExpandedRowSummary(
      prefix: line.kind == "assistant" ? "" : "$",
      text: stripLeadingPromptSymbol(compactText(line.text)),
      accent: line.kind == "assistant" ? Color.white.opacity(0.72) : agentIslandOrange,
      isUser: false
    )
  }
  if let line = latestActivityLine(for: session, kinds: ["user"]) {
    return ExpandedRowSummary(
      prefix: ">",
      text: stripLeadingPromptSymbol(compactText(line.text)),
      accent: agentIslandBlue,
      isUser: true
    )
  }
  if !detail.isEmpty {
    return ExpandedRowSummary(
      prefix: "$",
      text: detail,
      accent: statusAccentColor(for: session),
      isUser: false
    )
  }
  return ExpandedRowSummary(
    prefix: "$",
    text: expandedStatusText(for: session, strings: strings),
    accent: statusAccentColor(for: session),
    isUser: false
  )
}

func messagePreviewSummary(for session: AgentIslandSession) -> ExpandedRowSummary? {
  guard let line = session.messagePreview else { return nil }
  let text = stripLeadingPromptSymbol(compactText(line.text))
  if text.isEmpty { return nil }
  if line.kind == "user" {
    return ExpandedRowSummary(
      prefix: ">",
      text: text,
      accent: agentIslandBlue,
      isUser: true
    )
  }
  if line.kind == "assistant" {
    return ExpandedRowSummary(
      prefix: "",
      text: text,
      accent: Color.white.opacity(0.72),
      isUser: false
    )
  }
  return nil
}

func bestInteractionSummary(for session: AgentIslandSession, strings: AgentIslandStrings) -> String {
  if !session.detail.isEmpty {
    return stripLeadingPromptSymbol(session.detail)
  }
  // detail 为空时不再兜底捞 status/tool 活动行 —— 那是上一个 tool 的过期状态
  // (典型 'ask_user_question running...'),与"在等你"的语义打架。改为按
  // interactionKind 出人话,与 app 侧栏卡片 awaitingText 同一策略与文案。
  switch session.interactionKind {
  case "permission":
    return strings.awaitingPermission
  case "plan_review":
    return strings.awaitingPlan
  case "ask_user_question":
    return strings.awaitingQuestion
  default:
    return strings.needsInput
  }
}

func bestCompletedSummary(for session: AgentIslandSession, strings: AgentIslandStrings) -> String {
  if let line = latestActivityLine(for: session, kinds: ["assistant"]) {
    return stripLeadingPromptSymbol(compactText(line.text))
  }
  if let line = latestActivityLine(for: session, kinds: ["status", "tool"]) {
    let text = stripLeadingPromptSymbol(compactText(line.text))
    if text.lowercased() != "done" {
      return text
    }
  }
  if !session.compactDetail.isEmpty {
    return stripLeadingPromptSymbol(session.compactDetail)
  }
  return strings.completed
}

func bestErrorSummary(for session: AgentIslandSession, strings: AgentIslandStrings) -> String {
  if !session.detail.isEmpty {
    return stripLeadingPromptSymbol(session.detail)
  }
  if let line = latestActivityLine(for: session, kinds: ["status", "assistant", "tool"]) {
    return stripLeadingPromptSymbol(compactText(line.text))
  }
  return strings.error
}

func latestActivityLine(for session: AgentIslandSession, kinds: Set<String>) -> AgentIslandActivityLine? {
  for line in session.activityLines.reversed() {
    if kinds.contains(line.kind), !compactText(line.text).isEmpty {
      return line
    }
  }
  return nil
}

func stripLeadingPromptSymbol(_ text: String) -> String {
  let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.hasPrefix("$ ") || trimmed.hasPrefix("> ") {
    return String(trimmed.dropFirst(2))
  }
  return trimmed
}

func isGenericRunningStatusDetail(_ text: String) -> Bool {
  let normalized = text
    .trimmingCharacters(in: .whitespacesAndNewlines)
    .trimmingCharacters(in: CharacterSet(charactersIn: "."))
    .lowercased()
  return normalized == "generating"
    || normalized == "thinking"
    || normalized == "running"
    || normalized == "still running"
}

func expandedMetaText(for session: AgentIslandSession, updatedAt: Double) -> String {
  var parts: [String] = []
  if session.permissionAction != nil {
    let title = session.title.trimmingCharacters(in: .whitespacesAndNewlines)
    if isMeaningfulExpandedTitle(title) {
      parts.append(title)
    }
  }
  if let project = session.projectName?.trimmingCharacters(in: .whitespacesAndNewlines), !project.isEmpty {
    parts.append(project)
  }
  parts.append(sourceLabel(for: session.agentKind))
  parts.append(elapsedLabel(startedAt: session.startedAt, updatedAt: updatedAt))
  return parts.joined(separator: " · ")
}

func expandedStatusBadgeText(for session: AgentIslandSession, strings: AgentIslandStrings) -> String {
  switch session.phase {
  case "needs-interaction":
    return strings.input
  case "completed":
    return strings.done
  case "error":
    return strings.error
  default:
    return strings.running
  }
}

func expandedStatusText(for session: AgentIslandSession, strings: AgentIslandStrings) -> String {
  switch session.phase {
  case "needs-interaction":
    return session.detail.isEmpty ? strings.needsInput : session.detail
  case "completed":
    return strings.completed
  case "error":
    return session.detail.isEmpty ? strings.error : session.detail
  default:
    return session.detail.isEmpty ? strings.running : session.detail
  }
}

func sourceLabel(for agentKind: String) -> String {
  let lower = agentKind.lowercased()
  if lower.contains("codex") { return "Codex" }
  if lower.contains("claude") { return "Claude" }
  return agentKind.isEmpty ? "Agent" : agentKind
}

func elapsedLabel(startedAt: Double, updatedAt: Double) -> String {
  let elapsedMs = max(0, updatedAt - startedAt)
  let seconds = Int(elapsedMs / 1000)
  if seconds < 60 { return "\(max(1, seconds))s" }
  let minutes = seconds / 60
  if minutes < 60 { return "\(minutes)m" }
  return "\(minutes / 60)h"
}

func compactText(_ text: String) -> String {
  text
    .components(separatedBy: .newlines)
    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    .filter { !$0.isEmpty }
    .joined(separator: " ")
}


struct AgentIslandMascotView: View {
  let skin: String
  let state: AgentIslandMascotAnimationState
  let size: CGFloat

  var body: some View {
    if let config = AgentIslandMascotCatalog.spriteConfig(for: skin) {
      SpriteMascotView(size: size, state: state, config: config)
    } else {
      PululuMascotView(size: size, state: state)
    }
  }
}


private let agentIslandMascotPreviewStates: [(state: AgentIslandMascotAnimationState, label: String)] = [
  (.idle, "idle"),
  (.working, "working"),
  (.waitingApproval, "waitingApproval"),
  (.completed, "completed"),
]

private enum AgentIslandMascotPreviewAppearance: String, CaseIterable, Identifiable {
  case dark
  case light
  case both

  var id: String { rawValue }

  var title: String {
    switch self {
    case .dark: return "Dark"
    case .light: return "Light"
    case .both: return "两种模式"
    }
  }
}

/// 预览窗口的启动开关(命令行参数,不走环境变量:见 AgentIslandMascotPreview 的说明)。
private let agentIslandMascotPreviewFlag = "--mascot-preview"

private let agentIslandMascotPreviewZooms: [Double] = [1, 2, 3, 4, 6, 8]

/// 角色在产品里的真实渲染尺寸：
/// 16pt 收起 pill、18pt 紧凑行、20pt 展开态（灵动岛原生，本文件的调用点）；
/// 40pt 是设置页「图标皮肤」列表里的角色本体尺寸（renderer 的 `h-10 w-10`，
/// 见 AgentIslandSection.tsx `MascotPreviewImage` / `SpriteMascotPreview`）。
/// 设置页那套是 React/CSS 重画的，这里只作同尺寸参照，用来核对放大后的形态。
private let agentIslandMascotRealSizes: [(size: Double, label: String)] = [
  (16, "16 收起"),
  (18, "18 紧凑"),
  (20, "20 展开"),
  (40, "40 设置页"),
]

/// 单个「角色 × 状态」格子。底板只是预览用的对比背景，不代表产品视觉规范。
/// `size` 始终是产品真实渲染尺寸，`zoom` 只做视觉放大(几何比例不变)，便于肉眼看清细节。
private struct AgentIslandMascotPreviewCell: View {
  let skin: String
  let state: AgentIslandMascotAnimationState
  let label: String
  let size: CGFloat
  let zoom: CGFloat
  let isDark: Bool

  private var boxSide: CGFloat { size * zoom + 24 }

  var body: some View {
    VStack(spacing: 6) {
      ZStack {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .fill(isDark ? Color(white: 0.06) : Color(white: 0.97))
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .strokeBorder(isDark ? Color(white: 1.0, opacity: 0.10) : Color(white: 0.0, opacity: 0.10))
        AgentIslandMascotView(skin: skin, state: state, size: size)
          .scaleEffect(zoom)
      }
      .frame(width: boxSide, height: boxSide)
      Text(label)
        .font(.system(size: 10, weight: .medium, design: .monospaced))
        .foregroundStyle(.secondary)
    }
  }
}

/// 一整块网格：行 = 角色(取自 `AgentIslandMascotCatalog.skins`)，列 = 动画状态。
private struct AgentIslandMascotPreviewGrid: View {
  let size: CGFloat
  let zoom: CGFloat
  let isDark: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      ForEach(AgentIslandMascotCatalog.skins, id: \.self) { skin in
        HStack(alignment: .top, spacing: 16) {
          VStack(alignment: .leading, spacing: 2) {
            Text(skin)
              .font(.system(size: 12, weight: .semibold, design: .monospaced))
            Text(AgentIslandMascotCatalog.spriteConfig(for: skin) == nil ? "vector" : "sprite")
              .font(.system(size: 9))
              .foregroundStyle(.tertiary)
          }
          .frame(width: 96, alignment: .leading)
          .padding(.top, max(0, size * zoom / 2 - 8))

          ForEach(agentIslandMascotPreviewStates, id: \.label) { entry in
            AgentIslandMascotPreviewCell(
              skin: skin,
              state: entry.state,
              label: entry.label,
              size: size,
              zoom: zoom,
              isDark: isDark
            )
          }
        }
      }
    }
  }
}

/// 预览控件状态。本文件是顶层脚本(main.swift)模式，`@State` 的内联默认值在这里不可靠
/// (会退化成零值)，所以初值统一放到这个 model 的 init 里显式赋。
/// 另外这里的控件一律用 `Picker` 而不是 `Slider`：`Slider` 在本文件里出现过首帧把绑定值
/// 写回下界(初值丢失)，宽度受限时尤其容易触发。
private final class AgentIslandMascotPreviewModel: ObservableObject {
  @Published var appearance: AgentIslandMascotPreviewAppearance
  @Published var mascotSize: Double
  @Published var zoom: Double
  @Published var animationsActive: Bool
  @Published var animationEpoch: Int

  init() {
    appearance = .dark
    // 默认 = 灵动岛展开态真实尺寸 1:1，看细节再点放大档位，避免预览失真。
    mascotSize = 20
    zoom = 1
    animationsActive = true
    animationEpoch = 0
  }

  /// 首帧过后重新压一遍默认值。init 里的初值会被首帧布局改写(本文件的老毛病，
  /// 现有视图同样靠 onAppear 重置来兜)，这里补一刀保证工具条选中态与实际一致。
  func applyDefaults() {
    appearance = .dark
    mascotSize = 20
    zoom = 1
    animationsActive = true
  }
}

/// 自绘档位选择器。系统 `Picker` / `Slider` / `Toggle` 在本文件里会把绑定值改写成首项或
/// 下界(初值丢失)，这里改成 Button + 自管高亮，显示与 model 必然一致。
private struct AgentIslandPreviewChoice<Value: Equatable>: View {
  let options: [(value: Value, label: String)]
  @Binding var selection: Value

  var body: some View {
    HStack(spacing: 4) {
      ForEach(Array(options.indices), id: \.self) { index in
        let option = options[index]
        let isActive = option.value == selection
        Button {
          selection = option.value
        } label: {
          Text(option.label)
            .font(.system(size: 11, weight: isActive ? .semibold : .regular))
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(
              RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(isActive ? Color.accentColor.opacity(0.24) : Color.primary.opacity(0.06))
            )
        }
        .buttonStyle(.plain)
      }
    }
  }
}

private struct AgentIslandMascotPreviewView: View {
  @ObservedObject var model: AgentIslandMascotPreviewModel

  private var appearance: AgentIslandMascotPreviewAppearance { model.appearance }
  private var mascotSize: CGFloat { CGFloat(model.mascotSize) }

  var body: some View {
    VStack(spacing: 0) {
      toolbar
      Divider()
      ScrollView([.vertical, .horizontal]) {
        VStack(alignment: .leading, spacing: 28) {
          switch appearance {
          case .dark:
            grid(isDark: true)
          case .light:
            grid(isDark: false)
          case .both:
            labeledGrid(title: "Dark", isDark: true)
            labeledGrid(title: "Light", isDark: false)
          }
        }
        .padding(24)
      }
    }
    .frame(minWidth: 720, minHeight: 480)
    .onAppear {
      model.applyDefaults()
    }
  }

  private var toolbar: some View {
    HStack(spacing: 14) {
      AgentIslandPreviewChoice(
        options: AgentIslandMascotPreviewAppearance.allCases.map { ($0, $0.title) },
        selection: $model.appearance
      )

      HStack(spacing: 6) {
        Text("真实尺寸")
          .font(.system(size: 11))
          .foregroundStyle(.secondary)
        AgentIslandPreviewChoice(
          options: agentIslandMascotRealSizes.map { ($0.size, $0.label) },
          selection: $model.mascotSize
        )
      }

      HStack(spacing: 6) {
        Text("放大")
          .font(.system(size: 11))
          .foregroundStyle(.secondary)
        AgentIslandPreviewChoice(
          options: agentIslandMascotPreviewZooms.map { ($0, "\(Int($0))×") },
          selection: $model.zoom
        )
      }

      AgentIslandPreviewChoice(
        options: [(true, "播放"), (false, "暂停")],
        selection: $model.animationsActive
      )

      Button("从头播放") {
        model.animationEpoch += 1
      }
      .font(.system(size: 11))

      Spacer()

      Text(
        "\(AgentIslandMascotCatalog.skins.count) 角色 × \(agentIslandMascotPreviewStates.count) 状态 · 渲染 \(Int(model.mascotSize))pt"
      )
      .font(.system(size: 11, design: .monospaced))
      .foregroundStyle(.secondary)
    }
    .padding(.horizontal, 20)
    .padding(.vertical, 12)
  }

  private func grid(isDark: Bool) -> some View {
    AgentIslandMascotPreviewGrid(size: mascotSize, zoom: CGFloat(model.zoom), isDark: isDark)
      .agentIslandMascotAnimationsActive(model.animationsActive)
      .agentIslandMascotAnimationEpoch(model.animationEpoch)
  }

  private func labeledGrid(title: String, isDark: Bool) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(title)
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundStyle(.secondary)
      grid(isDark: isDark)
    }
  }
}

/// 由命令行参数 `--mascot-preview` 触发的独立预览窗口。
/// 刻意**不用环境变量**做开关：主进程 spawn helper 时会继承 `process.env`
/// (见 MacAgentIslandNativeHost.ts)，用户环境里若意外设置了该变量，产品 helper 会进
/// 预览分支、不 emit ready，被主进程判定超时反复重启。而 spawn 传的 argv 是空数组，
/// 命令行参数不存在这条泄漏路径。
/// 走这条分支时 helper 不读 stdin、不创建刘海面板，只当一个纯本地预览器。
private enum AgentIslandMascotPreview {
  static var isEnabled: Bool {
    CommandLine.arguments.dropFirst().contains(agentIslandMascotPreviewFlag)
  }

  private static var window: NSWindow?
  private static var closeObserver: NSObjectProtocol?
  private static var model: AgentIslandMascotPreviewModel?

  static func present() {
    let previewModel = AgentIslandMascotPreviewModel()
    model = previewModel
    let panel = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1120, height: 780),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    panel.title = "Agent Island — 角色动画预览"
    panel.contentView = NSHostingView(rootView: AgentIslandMascotPreviewView(model: previewModel))
    panel.center()
    panel.isReleasedWhenClosed = false
    // 预览时常要跟设计稿、素材目录来回对照，置顶省得反复找窗口。
    panel.level = .floating
    window = panel
    closeObserver = NotificationCenter.default.addObserver(
      forName: NSWindow.willCloseNotification,
      object: panel,
      queue: .main
    ) { _ in
      NSApp.terminate(nil)
    }
    NSApp.setActivationPolicy(.regular)
    panel.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }
}


struct AgentMenuBarState: Codable {
  let sessions: [AgentIslandSession]
  let strings: AgentIslandStrings
  let soundSettings: AgentIslandSoundSettings
  let mascotSkin: String
  let updatedAt: Double

  static let empty = AgentMenuBarState(sessions: [], strings: .fallback,
    soundSettings: .fallback, mascotSkin: "paimon", updatedAt: 0)

  var runningCount: Int { sessions.filter { $0.phase == "running" }.count }
  var waitingCount: Int { sessions.filter { $0.phase == "needs-interaction" }.count }
  var attentionCount: Int { sessions.filter { $0.attention }.count }
  var indicator: NSColor? {
    if waitingCount > 0 { return .systemOrange }
    if sessions.contains(where: { $0.phase == "error" && $0.attention }) { return .systemRed }
    if runningCount > 0 { return .systemGreen }
    if attentionCount > 0 { return .systemBlue }
    return nil
  }
  var accessibilitySummary: String {
    "\(strings.displayAppName): \(strings.running) \(runningCount), \(strings.needsInput) \(waitingCount), \(strings.done) \(sessions.filter { $0.phase == "completed" }.count)"
  }
}

final class AgentMenuBarModel: ObservableObject {
  @Published var state = AgentMenuBarState.empty
  @Published var open = false
  @Published var pendingRequests: Set<String> = []
  @Published var permissionErrors: [String: String] = [:]
}

struct AgentMenuBarContent: View {
  @ObservedObject var model: AgentMenuBarModel
  let eventSink: ([String: Any]) -> Void

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 10) {
        Text(model.state.strings.displayAppName).font(.headline)
        Spacer()
        Text("\(model.state.strings.running) \(model.state.runningCount)")
          .font(.caption).foregroundStyle(.secondary)
        Text("\(model.state.strings.needsInput) \(model.state.waitingCount)")
          .font(.caption).foregroundStyle(model.state.waitingCount > 0 ? Color.orange : Color.secondary)
      }
      .padding(14)
      Divider()
      if model.state.sessions.isEmpty {
        VStack(spacing: 10) {
          AgentIslandMascotView(skin: model.state.mascotSkin, state: .idle, size: 28)
          Text(model.state.strings.newConversationHint).foregroundStyle(.secondary)
          Button(model.state.strings.newConversationTitle) { eventSink(["type": "new-message"]) }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 26)
      } else {
        ScrollView {
          LazyVStack(spacing: 0) {
            ForEach(model.state.sessions) { session in
              AgentMenuBarRow(session: session, model: model, eventSink: eventSink)
              if session.id != model.state.sessions.last?.id { Divider().padding(.horizontal, 14) }
            }
          }
        }
        .frame(maxHeight: .infinity)
      }
      Divider()
      HStack {
        Button { eventSink(["type": "toggle-sound"]) } label: {
          Image(systemName: model.state.soundSettings.enabled ? "speaker.wave.2" : "speaker.slash")
        }
        .help(model.state.soundSettings.enabled ? model.state.strings.muteSound : model.state.strings.enableSound)
        .accessibilityLabel(model.state.soundSettings.enabled ? model.state.strings.muteSound : model.state.strings.enableSound)
        Button { eventSink(["type": "open-settings"]) } label: { Image(systemName: "gearshape") }
          .help(model.state.strings.settings).accessibilityLabel(model.state.strings.settings)
        Spacer()
        Button(model.state.strings.newMessage) { eventSink(["type": "new-message"]) }
      }
      .buttonStyle(.borderless).padding(12)
    }
    .frame(width: 360)
    .agentIslandMascotAnimationsActive(model.open)
  }
}

struct AgentMenuBarRow: View {
  let session: AgentIslandSession
  @ObservedObject var model: AgentMenuBarModel
  let eventSink: ([String: Any]) -> Void

  private var strings: AgentIslandStrings { model.state.strings }
  private var pending: Bool {
    guard let request = session.permissionAction else { return false }
    return model.pendingRequests.contains(request.requestId)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Button { eventSink(["type": "focus-session", "sessionId": session.id]) } label: {
        VStack(alignment: .leading, spacing: 5) {
          HStack(spacing: 8) {
            Image(systemName: statusSymbol).foregroundStyle(statusColor)
              .frame(width: 16)
            Text(session.displayTitle).font(.system(size: 13, weight: .medium))
              .foregroundStyle(.primary).lineLimit(1)
            Spacer(minLength: 4)
            Text(expandedStatusBadgeText(for: session, strings: strings))
              .font(.caption2).foregroundStyle(statusColor)
          }
          Text(expandedRowSummary(for: session, strings: strings).text)
            .font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(2)
          Text(expandedMetaText(for: session, updatedAt: model.state.updatedAt))
            .font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      if let request = session.permissionAction {
        // At compact menu width, labels wrap onto separate rows rather than clip.
        VStack(alignment: .leading, spacing: 6) {
          HStack {
            Button(strings.deny) { respond(request, "deny") }
            Spacer()
            if pending { ProgressView().controlSize(.small) }
            Button(strings.allowOnce) { respond(request, "allow") }.buttonStyle(.borderedProminent)
          }
          if request.canAllowForSession {
            Button(strings.alwaysAllowForSession) { respond(request, "allowForSession") }
          }
        }
        .controlSize(.small).disabled(pending)
        if let error = model.permissionErrors[request.requestId] {
          Text(error).font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
        }
      }
    }
    .padding(14)
  }

  private func respond(_ request: AgentIslandPermissionAction, _ action: String) {
    guard !pending else { return }
    model.permissionErrors.removeValue(forKey: request.requestId)
    model.pendingRequests.insert(request.requestId)
    eventSink(["type": "permission-action", "requestId": request.requestId, "action": action])
  }
  private var statusSymbol: String {
    switch session.phase {
    case "needs-interaction": return "hand.raised.fill"
    case "completed": return "checkmark.circle.fill"
    case "error": return "exclamationmark.circle.fill"
    default: return "circle.dotted"
    }
  }
  private var statusColor: Color {
    switch session.phase {
    case "needs-interaction": return .orange
    case "completed": return .green
    case "error": return .red
    default: return .secondary
    }
  }
}

@MainActor
final class AgentMenuBarController: NSObject, NSPopoverDelegate {
  let model = AgentMenuBarModel()
  let statusItem: NSStatusItem
  let popover = NSPopover()
  private let eventSink: ([String: Any]) -> Void
  private var iconSkin: String?
  private var icon: NSImage?
  private var outsideClickMonitor: Any?

  init(eventSink: @escaping ([String: Any]) -> Void = emitJson) {
    self.eventSink = eventSink
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    super.init()
    statusItem.autosaveName = "PaimonTasks"
    statusItem.button?.target = self
    statusItem.button?.action = #selector(togglePopover)
    popover.behavior = .transient
    popover.animates = true
    popover.delegate = self
    // The menu lives in a separate accessory process, not the Electron application.
    NSWorkspace.shared.notificationCenter.addObserver(self,
      selector: #selector(applicationActivated(_:)),
      name: NSWorkspace.didActivateApplicationNotification, object: nil)
    popover.contentViewController = NSHostingController(rootView: AgentMenuBarContent(model: model) { [weak self] event in
      self?.handleAction(event)
    })
    apply(state: .empty)
  }

  func apply(state: AgentMenuBarState) {
    model.state = state
    let liveRequests = Set(state.sessions.compactMap { $0.permissionAction?.requestId })
    model.pendingRequests.formIntersection(liveRequests)
    model.permissionErrors = model.permissionErrors.filter { liveRequests.contains($0.key) }
    updateStatusImage()
    let summary = state.accessibilitySummary
    statusItem.button?.toolTip = summary
    statusItem.button?.setAccessibilityLabel(summary)
    let height = state.sessions.isEmpty ? 205 : min(500, 90 + state.sessions.reduce(0) { $0 + ($1.permissionAction == nil ? 102 : 175) })
    popover.contentSize = NSSize(width: 360, height: height)
    // Data changes update the existing popover; only an explicit click opens it.
  }

  @objc func togglePopover() {
    if popover.isShown {
      popover.performClose(nil)
    } else if let button = statusItem.button {
      // Status-item clicks do not activate this accessory process. Without activation,
      // clicking the already-frontmost app sends no activation change and can leave the popover open.
      NSApp.activate(ignoringOtherApps: true)
      model.open = true
      popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
    }
  }

  func popoverDidShow(_ notification: Notification) {
    popover.contentViewController?.view.window?.makeKey()
    // Clicking an already-active application need not send a workspace activation notification.
    outsideClickMonitor = NSEvent.addGlobalMonitorForEvents(
      matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]
    ) { [weak self] _ in
      self?.popover.performClose(nil)
    }
  }

  @objc private func applicationActivated(_ notification: Notification) {
    guard let application = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
      application.processIdentifier != ProcessInfo.processInfo.processIdentifier else { return }
    popover.performClose(nil)
  }

  func popoverDidClose(_ notification: Notification) {
    stopMonitoringOutsideClicks()
    model.open = false
  }

  private func stopMonitoringOutsideClicks() {
    if let monitor = outsideClickMonitor {
      NSEvent.removeMonitor(monitor)
      outsideClickMonitor = nil
    }
  }

  func handleAction(_ event: [String: Any]) {
    let type = event["type"] as? String
    if type == "focus-session" || type == "open-settings" || type == "new-message" {
      popover.performClose(nil)
    }
    eventSink(event)
  }

  func permissionResult(requestId: String, error: String?) {
    model.pendingRequests.remove(requestId)
    if let error { model.permissionErrors[requestId] = error }
    else { model.permissionErrors.removeValue(forKey: requestId) }
  }

  func close() {
    stopMonitoringOutsideClicks()
    NSWorkspace.shared.notificationCenter.removeObserver(self)
    popover.performClose(nil)
    model.open = false
    NSStatusBar.system.removeStatusItem(statusItem)
  }

  private func updateStatusImage() {
    let skin = model.state.mascotSkin
    if iconSkin != skin {
      iconSkin = skin
      let view = AgentIslandMascotView(skin: skin, state: .idle, size: 18)
        .agentIslandMascotAnimationsActive(false)
      let renderer = ImageRenderer(content: view)
      renderer.scale = 2
      icon = renderer.nsImage
    }
    let base = icon
    let indicator = model.state.indicator
    let image = NSImage(size: NSSize(width: 22, height: 18), flipped: false) { _ in
      base?.draw(in: NSRect(x: 0, y: 0, width: 18, height: 18))
      if let indicator {
        NSColor.windowBackgroundColor.setFill()
        NSBezierPath(ovalIn: NSRect(x: 14, y: 11, width: 8, height: 8)).fill()
        indicator.setFill()
        NSBezierPath(ovalIn: NSRect(x: 15, y: 12, width: 6, height: 6)).fill()
      }
      return true
    }
    image.isTemplate = false
    statusItem.button?.image = image
  }
}

struct IncomingMessage: Codable {
  let type: String
  let state: AgentMenuBarState?
  let soundId: String?
  let soundPath: String?
  let requestId: String?
  let error: String?
}

func emitJson(_ payload: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else { return }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0a]))
}

@MainActor
final class AgentIslandAppDelegate: NSObject, NSApplicationDelegate {
  private var controller: AgentMenuBarController?

  func applicationDidFinishLaunching(_ notification: Notification) {
    if AgentIslandMascotPreview.isEnabled {
      AgentIslandMascotPreview.present()
      return
    }
    controller = AgentMenuBarController()
    emitJson(["type": "ready"])
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      while let line = readLine() { self?.handleLine(line) }
      DispatchQueue.main.async { NSApp.terminate(nil) }
    }
  }
  func applicationWillTerminate(_ notification: Notification) { controller?.close() }

  nonisolated private func handleLine(_ line: String) {
    guard let data = line.data(using: .utf8) else { return }
    do {
      let message = try JSONDecoder().decode(IncomingMessage.self, from: data)
      DispatchQueue.main.async { [weak self] in
        switch message.type {
        case "shutdown": NSApp.terminate(nil)
        case "update":
          if let state = message.state { self?.controller?.apply(state: state) }
        case "permission-result":
          if let requestId = message.requestId { self?.controller?.permissionResult(requestId: requestId, error: message.error) }
        case "play-sound":
          if let path = message.soundPath { AgentIslandSoundPlayer.shared.play(filePath: path) }
          else if let soundId = message.soundId { AgentIslandSoundPlayer.shared.play(soundId: soundId) }
        default: break
        }
      }
    } catch { emitJson(["type": "error", "message": "Could not decode menu bar update: \(error)"]) }
  }
}

let app = NSApplication.shared
let delegate = MainActor.assumeIsolated { AgentIslandAppDelegate() }
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
