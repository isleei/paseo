# Mac 菜单栏 helper：角色（mascot）开发说明

本目录是 macOS 菜单栏的 SwiftUI helper（`macos-agent-island-helper.swift`，单文件、
顶层脚本模式）与其素材，移植自 Cindy。产品运行时由
`src/features/island/native-host.ts` 以子进程方式拉起，通过 stdin/stdout 逐行
JSON 通信；打包时由 `scripts/build-island-helper.mjs` 编译并随包分发到
`resources/tools/agent-island/`，dev 模式由 native-host 懒编译到 userData。

跨进程协议与 TS 侧类型见 `src/features/island/agent-island-shared.ts`，
状态机见 `src/features/island/state.ts`，主进程编排见
`src/features/island/service.ts`。

## 角色动画预览（开发调试）

```bash
swiftc -O native/agent-island/macos-agent-island-helper.swift \
  -o /tmp/paseo-island-preview
XDT_AGENT_ISLAND_ASSET_DIR=$PWD/native/agent-island /tmp/paseo-island-preview --mascot-preview
```

会启动一个独立预览窗口：**行 = 角色，列 = 动画状态**，可切 Dark / Light /
两种模式同屏、切换真实渲染尺寸档位、放大倍数、暂停动画、从头播放。关窗即退出进程。

菜单栏图标是静态角色加状态点，固定一个图标位。动画只在用户点击打开的
`NSPopover` 中运行；数据更新不能自动打开它。不要恢复刘海窗口、屏幕定位或全局鼠标追踪。
角色预览是独立普通窗口，不读 stdin，也不创建菜单栏入口。

保留 `agent-island` 路径和素材名称用于构建与已有角色资源；产品入口已替换为菜单栏。
运行 `src/features/island/agent-island-shared.test.ts` 验证原生点击开关、任务更新不弹窗和退出清理。

## 新增一个角色

角色 = 一张身体 PNG + 一组眼睛几何参数 + 一套配色，**动画时间线是所有角色共享的**
（`SpriteMascotView`：`idle` / `working` / `waitingApproval` / `completed`），新增角色
不需要写动画代码。

1. `mascots/<skin>.png` —— 128×128 透明底（`whitesnow` 是 134×134 的历史例外，不要照抄）
2. `macos-agent-island-helper.swift`
   - 顶部加 `<skin>MascotFileName` 常量
   - `AgentIslandAssets` 加 `<skin>MascotImage`
   - `SpriteMascotConfig` 加 `static let <skin>`（眼睛坐标按素材实际眼位量）
   - `AgentIslandMascotCatalog.skins` 加 id，`spriteConfig(for:)` 加 case
3. `src/features/island/agent-island-shared.ts` —— `AgentIslandMascotSkin`
   类型 + `AGENT_ISLAND_MASCOT_SKINS`
4. 跑 `scripts/build-island-helper.mjs` 重新分发 mascots，并在预览窗口里验证

角色清单的单一真源是 `AgentIslandMascotCatalog.skins`（Swift 侧）与
`AGENT_ISLAND_MASCOT_SKINS`（TS 侧），两处必须一致；预览网格从前者派生，所以加完
第 2 步就能在预览窗口里看到新角色的全部状态。菜单栏与角色行为由
`src/features/island/agent-island-shared.test.ts` 守护。

## 本文件的两个 SwiftUI 陷阱

单文件顶层脚本（`main.swift` 语义）下踩过的坑，改这个文件时注意：

1. **`@State` 的内联默认值不可靠**，会退化成零值（`false` / `0`）。现有视图之所以正常，
   是因为它们的期望初值恰好就是零值，或在 `onAppear` 里显式重置。需要非零初值时，把状态
   放到 `ObservableObject` 的 `init` 里显式赋值（见 `AgentIslandMascotPreviewModel`）。
2. **控件初值会被吞掉**。`Slider` 首帧会把绑定值写回下界（`CGFloat`/`Double` 都复现），
   `Picker` 会写回首项。预览工具条因此改成自绘的 `AgentIslandPreviewChoice`（Button +
   自管高亮，显示与 model 必然一致）。
   遗留未解：换成自绘按钮后，`AgentIslandMascotPreviewModel.init` 里 `zoom = 3` 仍然只生效
   为 `1`（=档位首项），而同一个 init 里的 `appearance` / `mascotSize` / `animationsActive`
   初值都正常。根因未查明，当前把 `zoom` 默认值取成首项 `1` 规避（1× 也正是我们想要的默认
   真实尺寸）。若以后要给这类档位设非首项默认值，先验证初值有没有被改写。
