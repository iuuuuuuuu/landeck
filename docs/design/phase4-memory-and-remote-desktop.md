# LanDeck · 屏幕记忆 + 局域网远程桌面 设计规范（四期）

> 状态：契约定稿，四期实现的唯一依据。两批 teammate 并发实现，字段名/路由/语义以本文为准——**一期集成踩过的坑（两批各按理解实现字段名）就是从契约含糊来的，本文即防那个**。

## A. 屏幕记忆（截图 + OCR + 文字检索）

对齐 Hindsight 的「屏幕记忆与搜索」：定时截屏 → OCR → 关键词搜回"屏幕上出现过的字"，跳到截图与时刻。

### 采集（agent，internal/memory 包）

- **默认关闭**。启用后按 `intervalSec`（默认 60s，可配 15–300）截全屏（多显示器：全部拼接为一张宽图，v1 不做逐屏）。
- 截图实现：GDI BitBlt（user32/kernel32 syscall，对齐现有 foreground_windows 风格），PNG 编码（Go 标准库 image/png）。缩放：长边 >1920 时等比降到 1920 再存（省空间+OCR 更快）。
- **隐私命中即跳过**：截屏前查 activity 隐私规则（IsPrivate），前台应用命中则本 tick 不截。
- **存储**：`dataDir/memory/YYYY-MM/` 下 PNG 文件（文件名 `unixMs-ms.png`）；OCR 文本入库。**保留期默认 7 天**（对齐 Hindsight），每小时清理；设置可调 1–90 天。
- **OCR**：PowerShell + Windows.Media.Ocr（WinRT，系统内置，零外部依赖；中文依赖系统语言包，无则 OCR 结果为空但截图照存）。OCR 对**新截图**异步执行，不阻塞采集循环；结果 (text, ocrLang) 存库。
- **库表**（复用 activity 的 modernc SQLite 连接，独立表）：
  `shots(id INTEGER PK, ts INTEGER, app TEXT, ocr TEXT, file TEXT)`——app 是截屏瞬间的前台应用（复用 Sample）。

### API（agent）

| 路由 | 语义 |
| --- | --- |
| `GET /memory/search?q=&from=&to=&limit=` | 关键词 LIKE 检索（v1 不做 FTS），返回 `{items:[{id,ts,app,snippet,file}]}`，snippet 为命中词前后各 40 字符 |
| `GET /memory/image?id=` | 返回 PNG（`?token=` 免头鉴权，对齐 appicon 模式；ETag/304） |
| `GET /memory/status` | `{enabled, intervalSec, retentionDays, lastShotAt, shotsCount, ocrOk, ocrFail}` |
| `PUT /memory/settings` | `{enabled, intervalSec, retentionDays}` 部分更新（风格对齐 handleActivitySettingsPut） |

### 前端（/activity/memory，屏幕记忆页）

- nav 里的 disabled 占位（「截图 OCR 文字检索（二期）」）启用。
- 搜索框 + 日期范围 + 结果列表：缩略图（/memory/image，懒加载）+ 应用/时间/命中片段（命中词高亮用 `<mark>`）。
- 设置区：启用开关（开→确认弹窗写明「将定期截取全屏并保留 N 天」）、间隔、保留天数。
- 空态：功能未开启时显示开启引导（图标+说明+开关），对齐 AI 页引导卡水准。

## B. 局域网远程桌面（手机→PC、PC→PC）

### 架构判定

- **查看端是同一份 web 代码**（桌面 App 与 Android App 共用）：手机上触摸手势映射鼠标；电脑上看另一台电脑时用真实键鼠（浏览器焦点内捕获）。
- 走**被控端 agent 的 WebSocket**（现有 hub 之外新开专用端点，复用同一鉴权）。
- **v1 明确不做**：H.264/硬件编码、音频、文件拖传、多会话、录像。JPEG 帧流对 LAN 足够，先跑通闭环。

### 协议（RD-1，WebSocket，二进制帧 + JSON 控制帧）

**端点**：`GET /api/v1/rd/stream?token=…`（token 走 query，对齐 icons 模式）。

**会话**：单客户端；第二连接收到 `{type:"busy"}` 后关闭。会话空闲（无输入且无帧请求）60s 自动结束。**被控端屏幕边缘常驻指示条**（「正在被 XX 远程控制」）——远程桌面必须让被控机可见，这是有意的隐私设计。

**帧（agent → viewer）**：
- 二进制 WS 帧：`[0x01][4B unixMs][JPEG bytes]`（首字节消息类型，预留 0x02=光标形状更新）。
- 抓帧策略：有输入或首次连接时 8–12fps；静止时降到 1fps 心跳帧；帧间 diff（对上次 JPEG 尺寸+采样哈希，相同则跳过不发）。JPEG 质量 60，viewer 可请求 30–90（控制帧）。
- 分辨率：v1 固定主显示器全分辨率原始发送（LAN 带宽足够 1080p@10fps≈3–6MB/s，JPEG q60 实测约 1.5–3MB/s）。

**输入（viewer → agent，JSON 文本帧）**：
- `{t:"m", x:0.5, y:0.3, b:"l"|"r"|"m", a:"move"|"down"|"up"|"dbl"}` —— 坐标为**归一化 0..1**（viewer 按截图尺寸缩放显示，agent 乘回真实分辨率映射 SendInput）。归一化的理由：帧与屏幕分辨率解耦，viewer 端任意缩放都不需要 agent 感知。
- `{t:"w", dy:1}` 滚动（dy 正负表示方向）
- `{t:"k", code:65, mods:["ctrl","shift"], down:true}` —— code 为 Windows 虚拟键码（viewer 负责把 DOM keyCode 映射成 VK；映射表放前端，agent 只收 VK）
- `{t:"txt", text:"…"}` 长文本输入（移动端软键盘路径：不走逐键 VK，agent 侧用 SendInput KEYEVENTF_UNICODE）
- `{t:"q", quality:70}` 画质请求；`{t:"fps", fps:10}` 帧率请求
- 全部输入走 SendInput（对齐既有 control 包风格，不走 PowerShell）

**控制帧（双向）**：`{t:"hello", name:"…", os:"…"}`（会话建立，被控端指示条显示来源）、`{t:"bye"}`、`{t:"ping"}/{t:"pong"}`。

### 前端（web-rd 批）

- 路由 `/rd/:deviceId`：设备详情/设备卡新增「远程桌面」入口。
- Canvas 渲染（等比缩放适应视口，黑边留白）；顶栏悬浮条：画质/帧率切换、全屏、断开。
- 手机端（同一 web）：触摸映射——单击=左键、长按=右键、双指=滚动、双指捏合=本地缩放画面（不改 agent 分辨率）；软键盘呼出按钮 → `{t:"txt"}`。
- 电脑端：鼠标直接映射；键盘在画布聚焦时捕获（Esc 三连 = 强制释放焦点逃生口）。
- **被控端确认**：v1 采用「屏幕指示条 + agent 托盘通知」而非弹窗确认（LAN 场景 + 已配对信任链）；弹窗确认留设置开关（默认免确认，说明写清）。

### 分工与文件归属

| 批 | 执行者 | 范围 |
| --- | --- | --- |
| 记忆后端 | agent-activity | agent/internal/memory/**、agent/internal/httpapi/{memory.go, server.go 注册} |
| 记忆前端 | activity-pages | web/src/pages/activity/MemoryPage.tsx、web/src/components/memory/**、activityApi/keys 扩展、nav 启用 |
| RD 后端 | agent-rd（新） | agent/internal/rd/**、httpapi 只加一行注册（server.go 当轮归 agent-activity，与记忆批同——**路由注册由 agent-activity 统一接线**，agent-rd 只导出 Register） |
| RD 前端 | web-rd（新） | web/src/pages/rd/**、web/src/components/rd/**、web/src/lib/rdClient.ts、App.tsx 路由 |
| 集成 | lead | 拼装、构建部署、真机验证（手机+PC 双端）、门禁、推送 |

**server.go 归属**：本轮由 agent-activity 一人接线（memory 路由 + rd 的 Register 调用），杜绝二期那种双批同改一文件的撞车。

## C. 已知取舍（v1 明确不做，防止 scope 蔓延）

- H.264/硬件编码/WebRTC：v2 视带宽实测再定。
- 多显示器选择、远程粘贴剪贴板、文件拖传、会话录像。
- 离线/跨网段（当前仅 LAN，配对信任链已在）。
- 屏幕记忆的 FTS 全文索引（LIKE 够用再升级）。
