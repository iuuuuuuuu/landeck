# Agent Note: LanDeck 技术选型（Go Agent + React SPA + Tauri 壳）

Status: proposed

## Problem

要做一个局域网内控制多台 PC 的控制台：能开机、关机、重启、睡眠、休眠、定时任务、音量、媒体控制，
并能查看硬件信息、运行状态与开机统计；控制端覆盖 Android / macOS / Windows / Linux。
硬约束：**体积要小、启动要快、不许用 Electron**。

可选路线差异极大：Electron 生态最熟但体积 100 MB 级；Flutter 一套代码四端但要塞引擎；
四套原生最小最快但维护成本 ×4；纯浏览器零安装却不能发 UDP 广播。

## Proposal

1. **被控端 Agent 用 Go 单二进制**：交叉编译出 win/linux/mac 三份，`-s -w` 后 11–15 MB，
   常驻 28–45 MB，冷启 < 80 ms；系统控制走平台分支（Win 走 COM/SendInput + 系统 CLI，
   Linux 走 pactl/playerctl/systemctl，macOS 走 osascript/pmset），无运行时依赖。
2. **控制端界面只写一份 React + Vite SPA**，产物 230–280 KB gzip，`go:embed` 进 Agent，
   任何人用浏览器打开 `http://<device>.local:8420` 即可操作，做到零安装。
3. **装成 App 时用 Tauri v2 壳**：复用系统 WebView（WebView2/WKWebView/WebKitGTK），
   安装包 3.5–6 MB，冷启 ~400 ms；Rust 侧只做三件事：UDP 广播发现、密钥落 Keychain/DPAPI、托盘与自启。
4. **协议**：HTTP/1.1 + WebSocket + JSON；mDNS 注册 `<device>.local` 提供「局域网域名」；
   UDP 8421 广播做原生发现，浏览器回落成 `/hello` 扫段（并发 64）。
5. **配对**：固定密钥 + 6 位随机码（300 s 轮换、只在本机屏幕显示）双模式，
   服务端只存 token 的 SHA-256，三档权限，可单客户端吊销。

## Alternatives considered

- **Electron**：开发最省事、生态最全，是这类桌面壳的默认答案；但安装包 90–120 MB、
  常驻 150–260 MB、冷启 1.2–2 s，直接违反「小、快」两条硬约束，且用户明令禁止。故排除。
- **Flutter 一套代码四端**：UI 一致性与动画能力最好，团队只需一种心智；代价是每端打包
  ~40 MB 引擎、RSS 120 MB 起，且当前机器未装 Flutter 工具链，冷启也慢于系统 WebView 方案。排除。
- **Wails v3（Go 写壳）**：与 Agent 同语言、二进制也小；但 Android 与跨平台打包链弱于 Tauri v2，
  前端产物仍需另做，收益不足以抵消集成风险。列为备选而非首选。
- **四套原生客户端（WinUI/SwiftUI/GTK/Compose）**：体积与启动最优；但四份 UI 代码、
  四套构建与发版，单人维护不现实。当前阶段排除。
- **纯 PWA（不装壳）**：零体积、零安装、更新即时；致命点是浏览器不能发 UDP 广播，
  只能 HTTP 扫段（/24 约 2–4 s），也无法安全存密钥。因此保留为**免安装入口**，不作为唯一形态。

## Acceptance criteria

- Agent 三平台二进制 ≤ 15 MB，空闲 CPU < 0.5%，端口绑定到可服务 < 1 s。
- 前端生产构建 gzip ≤ 300 KB，首屏 < 400 ms（局域网）。
- Tauri 安装包 ≤ 6 MB（Windows MSI / macOS DMG / Linux AppImage），APK ≤ 7 MB。
- 一次控制动作端到端 ≤ 50 ms；WS 状态帧 ≤ 1 KB。
- 配对：错误密钥被限速拒绝，随机码过期即失效，吊销后旧 token 立即 401。

## Risks

- Tauri 在 Linux 依赖 WebKitGTK，部分精简发行版需额外装包（体积优势会被系统依赖抵消一部分）。
- 平台系统控制差异大（休眠在部分 Linux 需 root、macOS 关机需权限），需按平台降级并在 UI 标注不支持项。
- 浏览器扫段依赖被控端 CORS 放行，若用户网络隔离（AP 隔离/VLAN）会扫不到，需保留手动填 IP。
- 前端若不慎引入重型依赖（图表库/UI 框架），300 KB 预算会破，需要在构建门禁里卡住。
