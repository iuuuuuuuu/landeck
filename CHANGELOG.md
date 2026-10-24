# 更新日志

## v1.0.1 — 2026-10-24

修用户反馈的五个问题。

### 1. Windows 被控端不再是一个命令行黑框
- Agent 改为 `-H windowsgui` 构建 + 系统托盘：菜单含「打开控制台 / 复制配对码 / 已配对台数 /
  开机自启 / 打开数据目录 / 退出」，首次运行自动打开控制台页面显示随机码。
- 同时保留 `landeck-agent-windows-amd64-console.exe` 供排障。
- 日志改为写 `data/agent.log`（2 MB 轮转）。
- 「开机自启」直接在托盘里勾选，注册的是登录时启动的计划任务（跑在用户会话里，
  这样才能操作音频与媒体；注册成 Windows 服务会摸不到桌面）。

### 2. 硬件信息全空白（真 bug，已修）
`Get-PhysicalDisk` 的 `MediaType`/`BusType` 经 `ConvertTo-Json` 是字符串（`"SSD"` / `"NVMe"`），
Go 侧却按整数解析，`json.Unmarshal` 整体失败 → `collectHardware` 返回零值并被缓存 10 分钟。
已改成按字符串解析，并且**采集失败不再缓存零值**（否则要等 10 分钟才恢复）。

### 3. 白色（浅色）主题
- 令牌层重写：`:root[data-theme='light']` 覆盖同一批变量；面板、极光、噪点、图表、滚动条、
  选中色、focus ring、Slider 全部走变量。
- 顶栏三态切换（跟随系统 / 深色 / 浅色）+ 设置页「外观」分组；默认跟随系统，选择持久化。
- 浅色下正文对比度实测 ≥ 4.5:1（faint 也从 4.33 提到 5.5）。

### 4. 媒体状态不同步
- Windows 新增 SMTC 常驻助手（PowerShell + WinRT，进程常驻、单次查询 20–80 ms），
  能读到曲目/歌手/播放器/进度/播放状态；控制也走 SMTC，所以按完播放键控制端会真实变化。
- Linux 走 MPRIS（playerctl），macOS 走 nowplaying-cli。
- 新增 `GET /media` 与 WebSocket `media` 帧（2 秒一帧，与状态帧同频）。
- 播放位置按 `updatedAt` 外推，客户端再按本地时钟续推，进度条不会卡住。

### 5. 安卓 App
- 已生成 Android 工程（`app/src-tauri/gen/android`，含阿里云 Maven 镜像，解决国内拉依赖卡住）。
- `LanDeck-1.0.1-android.apk`（5.8 MB，universal release，已签名）随本版附上，直连安装即可。
- 构建注意：Gradle 需要 JDK 与 Android SDK/NDK；国内网络建议保留工程里的阿里云 Maven 镜像与
  Gradle 发行版镜像，JVM 不读环境变量代理，需要在 `gradle.properties` 里配 `systemProp.*.proxyHost`。

### 其他
- Windows 地址栏 `http://<主机名>.local:8420` 的 mDNS 注册保持可用。
- 已知：媒体状态在部分播放器（多为网页播放）可能只读不到、或传输指令返回 false，
  此时自动回退成系统媒体键。

## v1.0.0 — 2026-10-24

第一个可用版本。

### 被控端 Agent（Windows / Linux / macOS）

- **发现**：mDNS 注册 `<主机名>.local` 域名，UDP 8421 广播，浏览器可直接扫段发现。
- **配对**：固定密钥（长期有效）+ 6 位随机码（默认 300 秒轮换，只在本机控制台显示）；
  令牌在服务端只存 SHA-256，可按客户端吊销与换发，配对接口 10 次/分钟限流。
- **电源**：关机（延迟可取消）、重启、睡眠、休眠（系统支持时）、锁屏、注销、关闭屏幕。
- **音量 / 媒体**：Windows 走 Core Audio COM（1–20 ms），Linux 走 wpctl/pactl/playerctl，macOS 走 osascript。
- **进程**：按 CPU/内存排序、搜索、结束进程（系统关键进程黑名单；可按 PID 或唯一进程名）。
- **状态与信息**：CPU/内存/磁盘/网络/电池/温度实时推送（WebSocket 2s 一帧）、硬件清单、
  近 14 天开机时长统计、操作审计日志。
- **定时任务**：每天/每周/仅一次，支持 RTC 唤醒（关机前自动挂主板闹钟）。
- **MCP**：内置 10 个工具（状态/电源/音量/媒体/硬件/开机统计/定时/进程/杀进程/日志），
  HTTP 与 stdio 两种接入方式，AI 客户端可直接控制。

### 控制端

- **Web UI**：零安装，浏览器打开 `http://<被控机IP>:8420`，手机可用；深空极光风格，六页。
- **Tauri 桌面 App**：Windows 安装包 1.4 MB（NSIS）/ 1.9 MB（MSI），原生 UDP 扫描。

### 已知限制

- Android APK 未打包；手机请直接用浏览器（可「添加到主屏幕」）。
- Linux / macOS 仅完成交叉编译，未在实机跑过；Windows 已实测。
- 睡眠在启用了休眠的 Windows 上可能进入休眠（系统 API 行为），休眠需系统先启用。
- Linux RTC 唤醒需 root，macOS 需管理员权限。
- macOS 媒体键未装 `nowplaying-cli` 时只对 Music.app 生效。

### 体积

| 产物 | 大小 |
| --- | --- |
| Agent（win/linux/mac，5 个二进制） | 9.0–9.9 MB |
| 前端产物 | 909 KB（gzip 约 227 KB） |
| Windows 安装包 | 1.41 MB（NSIS）/ 1.85 MB（MSI） |
| Agent 常驻内存 | 约 33 MB |

## v1.0.2-pre — 2026-10-24（预测试版）

修第二轮反馈，并新增文件管理与应用级进程。

### 1. 桌面客户端（Tauri 壳）
- **修：扫描扫不到自己**。根因是 `tauri.conf.json` 缺 `withGlobalTauri`，Tauri v2 默认不注入
  `window.__TAURI__`，前端拿不到 `invoke` → 原生 UDP 广播没跑；而壳里 `location.hostname`
  是 `tauri.localhost`，推不出网段 → HTTP 扫段也没跑。**两条路同时失效**。
  已开 `withGlobalTauri`，并新增 `local_ip` 命令让原生层直接给出本机私有地址。
- 扫描改为「原生广播 + HTTP 扫段」并行，任一有结果都不影响另一条（旧版广播有结果就直接 return）。
- 新增 `autostart_get` / `autostart_set` 命令，桌面端可在界面里开关自启。
  Windows 写启动文件夹快捷方式（注册表 Run 键在本机被安全策略拒绝，实测连最小 Rust 程序都拿不到写权限）。
- 实测（`cargo test` 真跑）：`local_ip` 返回本机私有地址；UDP 广播成功发现同网段的 Agent。

### 2. 本机不再需要自己配对自己
`/hello` 新增 `self` 字段（loopback 或本机网卡地址即为真）。发现页把本机标为「本机」，
按钮是「直接进入」，点击后免令牌入库（`local: true`），API 走同源相对路径。
实测：全新浏览器 → 扫描 → 点「直接进入」→ 进入详情，store 里 `{local: true, token: ""}`。

### 3. 进程按应用聚合（用户视角）
新增 `GET /apps`、`POST /apps/kill`：同名进程合并成一个应用，显示总 CPU/内存/进程数/主 PID；
结束应用时**先子后父**整组结束，返回实际结束个数。系统关键应用（csrss/lsass/…）标记 `protected` 并拒绝。
实测：`csrss` 返回「这是系统关键进程，已拒绝结束」。

### 4. 文件管理（新功能）
`GET /files/roots|list|stat|download|preview`、`POST /files/upload|mkdir|rename|delete`。
- 只允许家目录/桌面/下载/文档/盘符根；系统目录默认拒绝（可开）；`..` 逃逸被 `filepath.Rel` 拦死。
- 上传走原始字节流（512 MB 上限）+ `.part` 临时文件原子替换；下载支持 Range 续传。
- 实测全链路：mkdir → upload → preview → download → rename → delete 全部成功；
  越权访问 `C:\Windows\System32` 与 `..\..\Windows` 均返回 `denied`。

### 5. 开机统计改用 echarts
手写柱图没有 y 轴参照，14 根柱看着等高。改用 echarts（按需引入 + 懒加载单独 chunk 171 KB gzip），
y 轴固定 0–24h、6h 刻度，柱高即真实占比；悬浮显示「X 小时 Y 分 / 启动 N 次」。
首屏 JS 仍 189 KB gzip。

### 6. 详情页布局
- 「设备信息」默认展开。
- 电源按钮**全部等宽**（实测 103px × 5，桌面与手机一致）；之前「每行铺满」导致 103/158 混排。
- 实时状态与硬件信息同高（实测 601/601）。
- 手机底部导航按导航项数量动态分列（加了「文件」后不再挤到第二行）。

### 7. 手机沉浸式状态栏
Android 侧 `enableEdgeToEdge` + 系统栏透明 + 关闭对比遮罩；网页用 `env(safe-area-inset-*)`
自行避让（顶栏 `pt-safe`、底栏 `pb-safe`、内容区 `px-safe`）。内容延伸到状态栏下方，不再硬挡一条色块。

## v1.0.3-pre — 2026-10-25（预测试版）

修第三轮反馈。

### 1. macOS 构建缺失 —— 补 CI 流水线
`.app` / `.dmg` **只能在 macOS 上产出**（Windows 上 `tauri build --bundles dmg` 会直接拒绝，
只有 msi/nsis 两个可选值）。之前发布里只有 macOS 的 Agent 二进制，没有 macOS 客户端安装包。
新增 `.github/workflows/release.yml`：打 tag 时用 `macos-latest` runner 构建
universal dmg（Intel + Apple Silicon），Windows / Linux / Android 各自并行，
产物汇总成 draft release。详见 `docs/BUILD.md`。
> CI 无 Apple 证书，产出未签名 dmg，首次打开需 `xattr -dr com.apple.quarantine`。

### 2. 手机上出现「开机自启」「从手机连上」—— 按运行环境收口
新增 `lib/runtime.ts` 判定 `web / desktop / android / ios`。
- 「开机自启」开关**只在桌面端 App 里出现**（手机 App 没有这个概念，浏览器也没有原生能力）。
- 删掉「这样随时都能从手机连上这台电脑」这类只对桌面端成立的描述。
- 实测：手机 390 宽设置页无「开机自启」、浏览器无「开机自启」、桌面端有。

### 3. 白屏 bug —— 已修（这条是我上一轮改坏的）
`/settings` 响应若少一层字段，`draft.tls.enabled` 直接抛
`Cannot read properties of undefined`，整个应用白屏。
- 新增 `normalizeSettings()`：缺什么补什么，不假设服务端返回完整结构。
- 新增 `ErrorBoundary`：包住每个路由内容，单块崩了只替换那一块并给出错误信息，不再整页空白。

### 4. 托盘打不开客户端 —— 已修
- 托盘菜单首项改成「打开 LanDeck」，点击**拉起客户端窗口**而不是跳浏览器。
- 查找顺序：`LANDECK_CLIENT` 环境变量 → 同目录 → 上级目录 → 注册表 `InstallLocation`
  → 开始菜单 `.lnk` 目标 → 常见安装路径；全都没有才退回浏览器。
- 实测：`openClientApp()` 成功拉起进程，窗口标题 `LanDeck`。

### 5. 新增「统计」页
`GET /stats` 一次返回设备画像（运行时长、CPU/内存/磁盘、应用与进程数、开机历史、操作统计），
前端不再发 5 个请求自己拼。页面含：总览六项指标、实时资源双环、磁盘占用、操作趋势柱图、
操作分类、操作来源（哪个客户端用得最多）。
