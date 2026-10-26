# Agent Note: 桌面端应用图标被 CSP 拦掉；定时任务改为页面直列；硬件放宽密度

Status: implemented

## Problem

v1.0.9 交付后用户反馈三条，其中一条是我上一版「以为做好了」的：

1. **应用图标在 PC 上看不到**。上一轮 `scan-owner` 实现了 PE 图标提取并用 curl 验证过端点 200，
   我自己的浏览器自检也显示 6 张图加载成功 —— 但用户用的是**桌面 App**，那边一张都没有。
2. **定时任务藏在抽屉第二 tab 里**。用户想看有没有设定时，得先点「管理工具」再切 tab。
3. **硬件信息太挤**。上一轮为了「压缩空白」把 3 列 + 3px 行距 + 12px 字号压到极致，
   结果值被大面积截断（`M425R4GA3BB0-...`），可读性反而下降。

## 根因（第 1 条，两层叠加）

- **第一层**：`AppRow` 从「路由 `:id` → 全局 activeId」猜当前设备。在 `/local` 页没有 `:id`、
  也没配对设备时会退回 `sameOriginIconUrl()`；而桌面 App 的页面源是 `tauri.localhost`，
  该函数明确排除它 → 返回空串 → 整列只剩首字母块。
- **第二层（决定性）**：即使 URL 拼对了，Tauri 的 CSP 是 `img-src 'self' data:`，
  **不包含 Agent 地址**。图片请求被浏览器直接拦掉 → `onError` → 回退字母块。
  这一层是 curl 测端点、浏览器测页面都发现不了的，只有真跑桌面 App 才会暴露。

## Decision

1. **图标地址由 `AgentClient` 提供**：`AppPanel` 把自己手里的 `client` 变成
   `iconUrlFor={(exe) => client.appIconUrl(exe)}` 传给 `AppRow`，不再靠路由/全局状态猜设备。
   `sameOriginIconUrl` 保留为兜底，并新增 `tauri.localhost → http://127.0.0.1:8420` 分支。
2. **CSP 放开 `img-src`**：加入 `http://*:8420 http://127.0.0.1:* https://*:8443 https://127.0.0.1:*`。
   这是本次的关键修复；不改 CSP 的话前端怎么改都白搭。
3. **去掉自定义「接近视口才加载」**：原用 IntersectionObserver 卡 240px，
   在嵌套滚动容器（应用列表是 `max-h-[420px]`）里判定时机不稳。改用原生 `loading="lazy"`，
   语义相同且由浏览器保证。
4. **定时任务直列**：新增 `ScheduleListCard`，在详情页与本机页直接列出任务
   （时间 / 名称 / 周期 / 启用状态），右上「新建」与行点击都跳到抽屉的 schedules tab
   （`DeviceToolsDrawer` 新增 `initialTab`）。
5. **硬件放宽**：栅格 3 列 → `xl:grid-cols-2`，Group 内边距 `px-2.5 py-1.5 → px-3 py-2.5`，
   行距 3px → 6px，字号 12 → 12.5，值从 `truncate` 改 `break-all`（长型号/序列号完整显示）。

## Alternatives considered

- **只改前端不改 CSP**：实测过 —— URL 正确、网络面板里连请求都没发出，全是 CSP 拦截。放弃。
- **图标走 base64 内联**：要多一轮 JSON 传输且无法被浏览器缓存，列表几十行会很重。放弃。
- **把图标放进 Tauri 的 asset 协议**：需要每条路径注册 scope，动态 exe 路径不可行。放弃。
- **定时任务只在抽屉里加个「最近一条」摘要**：用户要的是「直接罗列出来」，摘要不等于罗列。放弃。
- **硬件回到 3 列但加大字号**：列宽不足导致截断，问题在列数不在字号。放弃。

## Consequences

收益：桌面 App 能显示真实应用图标（实测 10/10 加载，WeChat/Edge/powershell 等都对）；
定时任务一眼可见；硬件值完整可读。

代价与边界：
- CSP 的 `img-src` 放宽到任意主机的 8420/8443 端口 —— 范围为 LAN 内 Agent，风险可控，
  但比 `'self' data:` 宽，属有意的取舍。
- `break-all` 让极长路径可能换行把行高撑高一点；比截断丢失信息可接受。
- 没有内嵌图标资源的 exe（Win11 Store 存根：`notepad.exe`/`taskmgr.exe`/`mstsc.exe`）
  仍回退字母块，这是 exe 本身没有图标，不是链路问题。
- iOS/Safari 不支持 `<img>` 渲染 ICO，苹果端会回退（要支持需服务端转 PNG）。

## 验证方式（这次吸取教训）

不再只测浏览器与 curl：用 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 开 CDP 进**真实桌面 App**，
`Page.captureScreenshot` 截图后用肉眼确认（图标确实出现、定时任务确实列出、硬件值不再截断）。
上一轮漏掉这一层，正是因为「端点 200 + 浏览器 6 张图」给了我错误的完成感。
