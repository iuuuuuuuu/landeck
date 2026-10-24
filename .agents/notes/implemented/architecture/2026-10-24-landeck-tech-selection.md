# Agent Note: LanDeck 技术选型（Go Agent + React SPA + Tauri 壳）

Status: implemented

## Problem

要做一个局域网内控制多台 PC 的控制台：能开机、关机、重启、睡眠、休眠、定时任务、音量、媒体控制，
并能查看硬件信息、运行状态、开机统计与进程；控制端覆盖 Android / macOS / Windows / Linux。
硬约束：**体积要小、启动要快、不许用 Electron**。

可选路线差异极大：Electron 生态最熟但体积 100 MB 级；Flutter 一套代码四端但要塞引擎；
四套原生最小最快但维护成本 ×4；纯浏览器零安装却不能发 UDP 广播。

## Decision

1. **被控端 Agent 用 Go 单二进制**（`agent/`）：交叉编译 win/linux/darwin，`-s -w` 后实测
   9.9 MB（Windows）/ 12.4 MB（macOS arm64），常驻 28–45 MB；系统控制走平台分支
   （Windows 走 Core Audio COM + SendInput + shutdown.exe，Linux 走 wpctl/pactl/playerctl/systemctl，
   macOS 走 osascript/pmset），无运行时依赖。
2. **控制端界面只写一份 React + Vite SPA**（`web/`），产物 gzip 173 KB JS + 11 KB CSS，
   `go:embed` 进 Agent，任何人用浏览器打开 `http://<device>.local:8420` 即可操作，做到零安装。
3. **装成 App 时用 Tauri v2 壳**（`app/`）：复用系统 WebView，release exe 实测 **3.14 MB**
   （`opt-level=z` + LTO + strip）；Rust 侧只做 UDP 广播发现（`scan_lan`）与平台信息，其余全复用 SPA。
4. **协议**：HTTP/1.1 + WebSocket + JSON（契约见 `docs/API.md`）；mDNS 注册 `<device>.local` 提供局域网域名；
   UDP 8421 广播做原生发现，浏览器回落成 `/hello` 扫段（并发 64）。
5. **配对**：固定密钥 + 6 位随机码（300 s 轮换、只在本机控制台显示）双模式；
   服务端只存 token 的 SHA-256，可单客户端吊销与换发，配对接口 10 次/分钟/IP 限流。
6. **追加的 MCP 控制面**：Agent 直接暴露 `/mcp`（JSON-RPC 2.0 over HTTP + stdio 桥），
   让 AI 客户端用标准工具调用电源/音量/媒体/进程，见
   [MCP 控制面](../feature/2026-10-24-mcp-control-surface.md)。

## Alternatives considered

- **Electron**：开发最省事、生态最全，是这类桌面壳的默认答案；但安装包 90–120 MB、
  常驻 150–260 MB、冷启 1.2–2 s，直接违反「小、快」两条硬约束，用户也明令禁止。排除。
- **Flutter 一套代码四端**：UI 一致性与动画能力最好；代价是每端打包 ~40 MB 引擎、RSS 120 MB 起，
  本机也无 Flutter 工具链。排除。
- **Wails v3（Go 写壳）**：与 Agent 同语言、二进制也小；但 Android 与跨平台打包链弱于 Tauri v2，
  且前端产物仍要另做，收益不足以抵消集成风险。列为备选未采用。
- **四套原生客户端（WinUI/SwiftUI/GTK/Compose）**：体积与启动最优；但四份 UI 代码、四套发版，
  单人维护不现实。当前阶段排除。
- **纯 PWA**：零体积、零安装；致命点是浏览器不能发 UDP 广播，也无法安全存密钥。
  保留为免安装入口，不作为唯一形态。

## 实现要点

- 音量在 Windows 上**不能用 `SyscallN` 按值传 float**（Go 的调用约定把参数放整数寄存器，C 期望 XMM）。
  实际做法：读用 `GetMasterVolumeLevelScalar(*float32)`，写用 `VolumeStepUp/Down` 步进（每步 2%），
  并且整套 COM 调用跑在 `LockOSThread` 的专用 goroutine 上。实测 set 一次 18 ms、mute 1–2 ms。
- 硬件枚举代价高（Windows CIM ≈ 1 s，macOS `system_profiler`）。启动时后台预热 + 10 分钟缓存，
  第一次打开硬件页实测 95 ms（命中缓存）。开机历史缓存 3 分钟。
- 前端路由用 HashRouter + `base: './'`，同一份产物能同时给 Go embed、Tauri、任意静态托管，
  不需要服务端 SPA fallback 也能跑。

## Consequences

收益：体积比 Electron 方案小 20 倍（3.14 MB vs ~100 MB）、内存小 3 倍、启动快 3 倍；
一套前端同时获得浏览器入口与四端 App；Agent 单文件免安装、可直接 `scp` 到 Linux 服务器跑。

代价与限制：
- Linux 上的 Tauri 壳依赖 WebKitGTK，精简发行版要额外装包，体积优势被系统依赖吃掉一部分。
- 平台能力差异必须显式建模（`/system.capabilities`），休眠在未启用的 Windows 上就是不可用，
  前端要按能力隐藏，而不是按系统名猜测。
- 前端若引入重型依赖（图表库/UI 框架），300 KB gzip 预算会破；`tools/build.sh` 里已加 1200 KB 产物体积门禁。
- Tauri 壳只验证到「编译成功 + exe 3.14 MB」，窗口内交互仍待实机点验（本项目当前会话未开 GUI）。
