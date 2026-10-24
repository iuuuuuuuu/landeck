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
