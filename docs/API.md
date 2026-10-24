# LanDeck 局域网 PC 控制台 — API 契约 v1

> 本文件是 **唯一事实来源**。Agent（Go）、Web UI（React）、App（Tauri）都按此实现。
> 任何字段变更必须先改本文件，并在 `.agents/notes/` 留决策笔记。

Base URL：`http(s)://<host>:8420/api/v1`

## 1. 发现（Discovery）

| 方式 | 说明 |
| --- | --- |
| mDNS | 服务类型 `_landeck._tcp`，TXT：`id`、`name`、`port`、`ver`、`tls` |
| UDP 广播 | 端口 `8421`。探测包 `LANDECK_DISCOVER_V1` → 单播回 `node` JSON；Agent 每 3s 向 `255.255.255.255:8421` 广播 `node` JSON |
| HTTP 探测 | `GET /api/v1/hello`，无鉴权，CORS `*`。浏览器端扫段用这个 |

```jsonc
// node
{ "v":1, "id":"9f3c…", "name":"DESKTOP-01", "port":8420, "tls":false,
  "ver":"1.0.0", "os":"windows", "paired":false }
```

`GET /hello` 额外返回 `ip`、`pairing`：

```jsonc
{ "v":1, "id":"…", "name":"DESKTOP-01", "ip":"192.168.1.20", "port":8420,
  "tls":false, "ver":"1.0.0", "os":"windows", "arch":"amd64",
  "pairing":{ "fixed":true, "random":true, "codeExpiresAt":"2026-10-24T16:00:00+08:00" },
  "paired":false }
```

## 2. 配对与鉴权

两种密钥：

* **固定密钥**：Agent 首次启动生成（形如 `7K9F-2M4Q`），可在设置里改写，长期有效。
* **随机密钥**：6 位数字，默认 300s 轮换/失效，只在 Agent 本机界面可见，可随时重置。

```http
POST /api/v1/pair          # 无鉴权，10 次/分钟/IP
{ "key":"7K9F-2M4Q", "kind":"fixed"|"random",
  "clientName":"YG 的 iPhone", "clientId":"<uuid>" }
->
200 { "token":"ldk_…", "clientId":"…", "clientName":"…",
      "server":{ "id":"…", "name":"…", "port":8420, "tls":false, "ver":"1.0.0" } }
401 { "error":"invalid_key" }
429 { "error":"rate_limited" }
```

之后所有请求：

```http
Authorization: Bearer ldk_…
```

错误体统一：`{ "error":"<code>", "message":"人话" }`，HTTP 4xx/5xx。

`GET /session` → `{ clientId, clientName, role:"owner"|"controller"|"viewer", createdAt, lastSeenAt }`

`role`：`owner` 可管理密钥与客户端；`controller` 可操作；`viewer` 只读。

## 3. 系统 / 状态 / 硬件

```http
GET /system
{ "id":"…", "name":"DESKTOP-01", "hostname":"DESKTOP-01",
  "os":"Windows 11 Pro", "platform":"windows", "arch":"amd64",
  "kernel":"10.0.22631", "agentVersion":"1.0.0",
  "bootTime":"2026-10-24T08:12:11+08:00", "uptimeSec":26403,
  "time":"2026-10-24T15:33:14+08:00", "timezone":"Asia/Shanghai",
  "features":{ "power":true,"media":true,"volume":true,"wol":true,
               "schedules":true,"hardware":true,"processes":true,
               "shell":false,"battery":false },
  "capabilities":{ "sleep":true,"hibernate":true,"wake":true,"screenOff":true } }
```

```http
GET /status                # 2s 轮询或走 WS
{ "time":"…",
  "cpu":{ "percent":12.4, "model":"…", "cores":16, "threads":24, "freqMhz":3800,
          "perCore":[3.1,…], "load":[0.42,0.51,0.66] },
  "mem":{ "used":123,"total":32768,"percent":37.6,"swapUsed":0,"swapTotal":0 },
  "disks":[ { "mount":"C:", "fs":"NTFS", "used":312,"total":932,"percent":33.5 } ],
  "net":{ "rxBps":20480, "txBps":1024, "iface":"以太网", "ip":"192.168.1.20", "mac":"…" },
  "battery":{ "percent":88, "charging":true, "timeLeftMin":null } | null,
  "temps": [ { "name":"CPU", "c":54 } ],
  "processes": { "total":382, "top":[ {"name":"chrome","cpu":12.1,"memMb":820} ] },
  "uptimeSec":26403, "bootTime":"…" }
```

```http
GET /hardware
{ "cpu":{ "model":"AMD Ryzen 9 7950X", "vendor":"AuthenticAMD", "cores":16,
          "threads":32, "baseMhz":4500, "cacheKb":65536, "socket":"AM5" },
  "memory":{ "totalBytes":68719476736, "type":"DDR5", "speedMhz":5600,
             "slots":[ { "bank":"DIMM_A1", "sizeBytes":34359738368,
                         "speedMhz":5600, "manufacturer":"Kingston",
                         "partNumber":"KF556C40-32" } ] },
  "gpus":[ { "name":"NVIDIA GeForce RTX 4080", "vramMb":16376, "driver":"581.15" } ],
  "disks":[ { "name":"Samsung SSD 990 PRO 2TB", "type":"NVMe", "sizeBytes":2000398934016,
              "serial":"…", "health":"ok" } ],
  "nics":[ { "name":"Realtek 2.5GbE", "mac":"…", "speedMbps":2500, "ipv4":["192.168.1.20"] } ],
  "board":{ "manufacturer":"ASUS", "model":"ROG STRIX B650E-F", "bios":"2402" },
  "os":{ "name":"Windows 11 Pro", "version":"10.0.22631", "installedAt":"2024-03-02" } }
```

## 4. 控制

统一走一个入口，便于扩展与审计：

```http
POST /actions
{ "action":"power.shutdown", "params":{ "delay":5, "force":false } }
->
200 { "ok":true, "action":"…", "detail":"…", "durationMs":12 }
409 { "error":"unsupported", "message":"当前平台不支持休眠" }
```

动作清单：

| action | params | 说明 |
| --- | --- | --- |
| `power.shutdown` | `delay`(s,默认5) `force` | 关机 |
| `power.restart` | `delay` `force` | 重启 |
| `power.sleep` | — | 睡眠 |
| `power.hibernate` | — | 休眠 |
| `power.lock` | — | 锁屏 |
| `power.logoff` | — | 注销 |
| `power.screen_off` | — | 仅关屏 |
| `power.cancel` | — | 取消待执行的关机 |
| `volume.set` | `value` 0-100 | 设音量 |
| `volume.up` / `volume.down` | `step` 默认 5 | 步进 |
| `volume.mute` / `volume.unmute` / `volume.toggle_mute` | — | 静音 |
| `media.play_pause` | — | 播放/暂停 |
| `media.next` / `media.prev` / `media.stop` | — | 切歌/停止 |
| `wake.on_lan` | `mac` | 发魔术包唤醒别的机器 |
| `app.launch` | `path` | 仅 `features.allowShell` 时启用 |

便捷别名（UI 用）：`POST /power {op}`、`POST /volume {op,value}`、`POST /media {op}`，语义同上。

```http
GET /volume
{ "level":42, "muted":false, "known":true }
```

`GET /actions` → `{ "actions":[ {"action":"power.shutdown","supported":true,"params":{…}} ] }`

## 5. 开机统计

```http
GET /uptime/history?days=14
{ "days":[ { "date":"2026-10-24", "onSec":26403, "boots":1, "firstOn":"08:12", "lastOff":null } ],
  "boots":[ { "at":"2026-10-24T08:12:11+08:00", "kind":"boot", "uptimeSec":0 } ],
  "totals":{ "onSec7d":412800, "boots7d":6, "avgUptimeSec":68800, "longestSec":290000 } }
```

数据来源：Windows 事件日志（6005/6006/1074/42/107）、Linux `last -x` / `journalctl`、macOS `last reboot`；
落盘 `data/boots.jsonl`。

## 5.4 媒体状态

```http
GET /media
{ "known":true, "active":true, "playing":true,
  "title":"Never Gonna Give You Up", "artist":"Rick Astley", "album":"Whenever You Need Somebody",
  "app":"Spotify", "status":"Playing",
  "positionSec":42.7, "durationSec":213.0, "updatedAt":1792840431.05 }
```

* Windows 走 SMTC（`GlobalSystemMediaTransportControlsSessionManager`），Linux 走 MPRIS（playerctl），
  macOS 走 `nowplaying-cli`（未安装时 `known=false`）。
* `positionSec` 由服务端按 `updatedAt` 外推，客户端可再按本地时钟续推。
* `active=false` 表示当前没有媒体会话；`known=false` 表示该平台读不到状态（但仍可下发控制指令）。
* 媒体控制与状态走同一条 SMTC 会话：`media.play_pause` 之后 1–2 秒内 `GET /media` 会反映真实状态；
  个别播放器不接受 SMTC 指令（返回 false）时自动回退成发送系统媒体键。

## 5.5 进程

```http
GET /processes?sort=cpu|mem|name|pid&limit=60&q=chrome
{ "items":[ { "pid":36172, "parent":15908, "name":"node.exe", "cpu":11.2,
              "memMb":2344, "user":"yg", "status":"", "exe":"C:\...\node.exe",
              "startedAt":"2026-10-23T19:00:40+08:00" } ],
  "total": 60 }
```

* `cpu` 已归一化为「整机百分比」（多核累加值 ÷ 核数），可直接和任务管理器对比。
* 首次请求约 300–500ms（两次采样算瞬时 CPU），客户端请给 loading 态。

```http
POST /processes/kill
{ "pid":36172, "force":true }        // 或者 { "name":"chrome", "force":false }
->
200 { "ok":true, "pid":36172 }
400 { "error":"failed", "message":"这是系统关键进程，已拒绝结束（lsass.exe）" }
```

* `force=true` → `Kill`（TerminateProcess / SIGKILL）；`false` → `Terminate`（SIGTERM 类）。
* 同名进程不唯一时只接受 `pid`，避免误杀一整个进程组。
* 系统关键进程（system/csrss/wininit/lsass/services… /init/systemd/launchd）一律拒绝。
* 需要 `features.allowProcessKill`（默认开，可在设置里关；关掉后查看与结束都返回 409）。

## 6. 定时任务

```http
GET  /schedules              -> { "items":[Schedule] }
POST /schedules              body: Schedule (无 id) -> Schedule
PUT  /schedules/{id}         body: Schedule
DELETE /schedules/{id}
```

```jsonc
// Schedule
{ "id":"sch_ab12", "name":"每天 23:30 关机", "enabled":true,
  "action":"power.shutdown", "params":{ "delay":0 },
  "when":{ "kind":"daily"|"weekly"|"once", "time":"23:30",
           "weekdays":[1,2,3,4,5], "at":"2026-10-25T23:30:00+08:00" },
  "wake":{ "enabled":true, "leadSec":60 },   // 睡眠/关机时挂 RTC 唤醒
  "lastRunAt":"2026-10-23T23:30:00+08:00", "nextRunAt":"2026-10-24T23:30:00+08:00" }
```

## 7. 客户端密钥管理 / 设置 / 日志

```http
GET    /clients                       -> { "items":[ {id,name,role,ip,createdAt,lastSeenAt} ] }
DELETE /clients/{id}
POST   /clients/{id}/rotate           -> { "token":"ldk_…" }   # 换发令牌
GET    /pairing                       -> { fixedKeyMasked, fixedKeySet, randomEnabled,
                                            code, codeExpiresAt, requireLocalCode }
PUT    /pairing                       body { fixedKey?, randomEnabled? }
POST   /pairing/code/rotate           -> { code, codeExpiresAt }
GET    /settings                      -> { deviceName, port, tls, features, locale, theme }
PUT    /settings
GET    /activity?limit=100&before=<ts> -> { "items":[ {id,at,clientName,action,params,ok,detail} ] }
```

## 8. 实时通道

```http
WS /api/v1/ws?token=ldk_…
```

服务端推送（1 帧/2s）：

```jsonc
{ "type":"status", "data":{...同 /status...} }
{ "type":"media",  "data":{...同 /media...} }
{ "type":"event",  "data":{ "event":"action", "action":"power.shutdown", "ok":true, "clientName":"…", "at":"…" } }
{ "type":"pairing","data":{ "code":"284 913", "expiresAt":"…" } }
```

客户端可发：`{"type":"ping"}` → `{"type":"pong"}`；`{"type":"watch","interval":1000}`。

## 8.5 MCP（AI 控制面）

`POST /mcp` —— JSON-RPC 2.0 over HTTP（MCP Streamable HTTP 传输），鉴权同上（`Authorization: Bearer ldk_…`）。

```jsonc
// initialize
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}
-> {"result":{"protocolVersion":"2025-06-18",
     "capabilities":{"tools":{"listChanged":false}},
     "serverInfo":{"name":"landeck","version":"1.0.0"}}}

// tools/list -> tools: landeck_status / landeck_power / landeck_volume / landeck_media /
//                        landeck_hardware / landeck_uptime / landeck_schedules /
//                        landeck_processes / landeck_kill_process / landeck_activity

// tools/call
{"jsonrpc":"2.0","id":2,"method":"tools/call",
 "params":{"name":"landeck_power","arguments":{"op":"sleep"}}}
-> {"result":{"content":[{"type":"text","text":"{\"ok\":true,\"detail\":\"已进入睡眠\"}"}],
     "isError":false}}
```

stdio 桥：`landeck-agent mcp --host 127.0.0.1 --port 8420 --token ldk_…`（或环境变量 `LANDECK_TOKEN`），
把 stdin 的 JSON-RPC 逐行转发到本机 Agent，供 Claude Desktop 之类的客户端直接拉起。

## 9. 静态站点

* `GET /` 及任意前端路由 → 内嵌 Web UI（SPA fallback）
* `GET /healthz` → `ok`（无鉴权，供监控）

## 10. CORS

`/hello`、`/pair`、`/healthz` 允许 `*`；其余允许同源 + `http(s)://localhost*` +
显式白名单（`settings.corsOrigins`），并支持预检。
