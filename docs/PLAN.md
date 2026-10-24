# LanDeck 技术方案（待确认稿 v1）

> 约束：**小**、**快**、**禁止 Electron**。目标是一台常驻 Agent + 一个可以到处装的控制端 App。

## 1. 一句话方案

**Go 单文件 Agent（每台 PC 一个，约 12 MB）+ 内嵌 React SPA（约 250 KB gzip）+ Tauri v2 壳（复用系统 WebView，安装包 3–6 MB）**。
协议是 HTTP/1.1 + WebSocket + JSON，发现走 mDNS + UDP 广播。没有 Electron，没有 Chromium 副本，没有 Node 运行时。

```
┌──────────────── 控制端（手机 / 平板 / 电脑）────────────────┐
│  Tauri v2 壳（系统 WebView，3–6 MB）                        │
│    ├─ 原生层：UDP 广播发现、密钥存 Keychain/DPAPI、托盘、自启 │
│    └─ 复用同一份 React SPA（也可直接用浏览器打开，零安装）    │
└───────────────────────────┬────────────────────────────────┘
                            │ HTTP/JSON + WS（局域网，可 TLS）
                            │ 配对：固定密钥 / 6 位随机码
┌───────────────────────────┴────────────────────────────────┐
│  LanDeck Agent（Go 单二进制，win/linux/mac 各一份 ~12 MB）    │
│  ├─ httpapi：REST + WS + 内嵌 SPA（go:embed）                │
│  ├─ auth：token 配对、限速、客户端吊销                       │
│  ├─ discovery：mDNS（xxx.local 域名）+ UDP 8421 广播         │
│  ├─ control：电源/音量/媒体（平台分支，纯系统调用 + 少量 CLI）│
│  ├─ telemetry：CPU/内存/磁盘/网卡/开机历史（gopsutil + 事件日志）│
│  └─ scheduler：定时开关机、RTC 唤醒                          │
└─────────────────────────────────────────────────────────────┘
```

## 2. 体积 / 内存 / 启动（可验收的硬指标）

| 组件 | 体积 | 常驻内存 | 冷启动 | 说明 |
| --- | --- | --- | --- | --- |
| Agent 二进制（三平台） | **11–15 MB** | **28–45 MB** | **< 80 ms** | 静态链接，`-ldflags "-s -w"`，无运行时依赖 |
| 内嵌 Web UI | **230–280 KB gzip** | — | 首屏 **< 400 ms**（局域网） | go:embed 直接吐，无 CDN |
| Tauri 安装包 | **3.5–6 MB** | 60–90 MB（含系统 WebView 共享） | **~400 ms** | MSI / DMG / AppImage / APK |
| APK | **5–7 MB** | 60–90 MB | ~500 ms | Tauri v2 Android |
| 单次控制往返 | — | — | **8–35 ms** | 局域网 HTTP，动作本身 + 系统调用 |
| WS 状态帧 | **~600 B / 2 s** | — | — | 只推变化量，空闲几乎为零流量 |

对照 Electron：安装包 90–120 MB、常驻 150–260 MB、冷启 1.2–2 s。**本方案体积小 20 倍、内存小 2–3 倍、启动快 3 倍。**

## 3. 为什么是这个组合（备选都算过）

| 方案 | 优点 | 决策 |
| --- | --- | --- |
| **Tauri v2（选中）** | 安装包 3–6 MB；Win 用 WebView2（系统自带）、mac 用 WKWebView、Linux 用 WebKitGTK；Rust 原生层能做 UDP 广播和系统集成 | ✅ 体积/开发成本的甜点 |
| Wails v3 | Go 写壳，和 Agent 同语言 | ⚠️ 体积相近，但生态与 Android/cross 支持弱，打包链更绕 |
| Flutter | 一套代码四端，UI 一致 | ❌ 每端塞 ~40 MB 引擎，RSS 120 MB+，与「小」冲突；本机也没有 Flutter 环境 |
| Electron | 生态最熟 | ❌ 明令禁止 |
| 四套原生（WinUI/SwiftUI/GTK/Compose） | 体积最小、最快 | ❌ 四份代码维护成本 ×4，本阶段不划算 |
| 纯 PWA / 浏览器 | 零安装、零体积 | ✅ 保留为**免安装入口**（Agent 自带页面），但浏览器不能发 UDP 广播，靠 HTTP 扫段兜底 |

结论：**一个 Agent 用 Go（跨三平台、编译产物小、系统调用直接）+ 一份前端（React/Vite）+ Tauri 壳（可选装）**。
手机/临时设备直接开浏览器访问 `http://<主机名>.local:8420` 就能用，不强制装 App。

## 4. 协议与安全

- **传输**：HTTP/1.1 + WebSocket，JSON；局域网明文，可一键开自签 TLS（8443）。
- **域名**：mDNS 注册 `<device>.local`，用户可记 `http://desktop-01.local:8420`，IP 变了也能找到。
- **发现**：UDP 8421 广播（原生壳）+ HTTP `/hello` 探测（浏览器扫段，并发 64，/24 约 2–4 s 出结果）。
- **两种密钥**：
  - 固定密钥：首启生成 `7K9F-2M4Q`，可在设置里换，长期有效。
  - 随机密钥：6 位数字，默认 300 s 轮换，只显示在被控机本机屏幕上（防远程撞码）。
- **配对**：`POST /pair` → 下发 `ldk_…` token（服务端只存 SHA-256），10 次/分钟/IP 限速，成功后写入客户端本地（Tauri 用 Keychain/DPAPI，浏览器用 localStorage）。
- **权限**：owner / controller / viewer 三档，可随时吊销单个客户端。
- **危险动作**：关机/重启默认 5 s 延迟可取消；Shell 执行默认关闭。

## 5. 功能切片（每片都能单独验收）

| 里程碑 | 内容 | 验收方式 |
| --- | --- | --- |
| **M1 骨架** | 仓库规范、API 契约、设计令牌、组件库 | ✅ 已建 |
| **M2 能控** | 发现 + 配对 + 开关机/睡/重启/锁屏 + 音量 + 媒体键 + WS 实时状态 | 真机：手机连 Windows 主控，音量/媒体真跑；关机走 dry-run + 5 s 可取消 |
| **M3 能看** | 硬件信息、运行状态、开机统计（事件日志聚合）、活动日志 | 对比系统信息逐项核对 |
| **M4 定时** | 定时关机/重启/睡眠、RTC 唤醒、工作日规则 | 真跑一次 2 分钟后的定时任务 |
| **M5 打包** | 三平台 Agent + 服务自启（SCM/systemd/launchd）+ Tauri 四端壳 + Web 免安装 | 装机实测 |

## 6. 目录结构

```
lan_pc_control/
├─ agent/                 # Go Agent（核心，先做）
│  ├─ cmd/landeck-agent/
│  └─ internal/{config,auth,discovery,httpapi,control,telemetry,scheduler,webui}
├─ web/                   # React SPA（同时给 Agent 与 Tauri 复用）
│  ├─ src/{components/ui,components/device,pages,lib,store}
│  └─ dist/               # 构建后 embed 进 Agent
├─ app/                   # Tauri v2 壳（win/mac/linux/android）
├─ docs/{API.md,PLAN.md}
└─ .agents/notes/         # 决策笔记（已接入校验门禁）
```

## 7. 性能预算怎么守住

- 前端：路由级懒加载、不引 UI 框架（只有 tailwind + motion + lucide），生产构建 gzip **≤ 300 KB**，`vite build --report` 卡门禁。
- Agent：空闲 CPU **< 0.5%**，采样 2 s 一次、WS 只推订阅者；历史数据 JSONL 按天切分，单文件 **≤ 2 MB**。
- 启动：Agent 在 `main` 里先绑端口再初始化慢模块（硬件枚举走懒加载），保证 **< 1 s 可服务**。

## 8. 需要你拍板的三件事

1. **控制端形态**：Tauri 壳（3–6 MB，四端一致）＋浏览器免安装入口 —— ➡️ 推荐照此做。
2. **手机端要不要原生 App**：先给浏览器/PWA + Tauri APK 两条路，都不装也能用 —— ➡️ 推荐先 PWA，APK 随后。
3. **Agent 默认端口**：8420（HTTP）/ 8421（发现）/ 8443（可选 TLS） —— ➡️ 推荐保持，可配置。
