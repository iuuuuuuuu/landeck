# Agent Note: 抽屉弹窗去 framer-motion、下线统计/活动页、设备头像改用系统账户头像

Status: implemented

## Problem

用户提出四项：

1. 「管理工具 弹窗有点卡顿」
2. 「统计和活动页面没啥用直接删除了吧」
3. 「设备的头像还是没有从系统中获取头像」
4. 「默认的 logo 和设备详情页的 logo 也不一致」

## Decision

### 1. 抽屉弹窗去 framer-motion + 去 backdrop-blur

`DeviceToolsDrawer` 原来用 `AnimatePresence` + `motion.aside`
（`initial/animate/exit` 的 x 位移 + opacity，spring），并叠了 `backdrop-blur-xl`。
位移动画会触发 framer-motion 的布局测量，`backdrop-blur` 又要重建合成层 ——
这与之前 `AppShell` / `Radar` / `Button` 踩到的是同一类问题。

改成纯 CSS keyframes（`drawer-scrim` / `drawer-panel`，见 `index.css`）：
只动 opacity 与 transform，走合成层。关闭时不再做滑出动画（直接卸载），
换来打开瞬间不掉帧。

### 2. 下线统计页与活动页（前后端一起）

前端：删 `pages/Stats.tsx`、`pages/Activity.tsx` 及专用组件
`components/device/StatsPanel.tsx`、`StatsHero.tsx`；导航从 6 项减到 4 项
（本机 / 设备 / 发现 / 设置）；`/stats`、`/activity` 路由改为重定向到 `/devices`
（不留 404）；清理 `nav.ts` 未用的图标 import、`api.ts` 的 `stats()`/`activity()`
方法与 `StatsOverview`/`ActivityItem` 类型引用。

后端：删除 `/api/v1/stats`、`/api/v1/activity` 两条路由与 `handleStats`、
`handleActivity` 两个 handler。经查这两个 handler 没有其他调用方，
删掉即释放两处聚合采样开销与攻击面。

保留的 `metrics.AppProcCount()`（上一轮为优化 stats 而新增）暂时无调用方，
但它是轻量进程计数的通用能力，留着不影响编译，将来进程面板可能用上。

### 3. 设备头像改用 Windows 系统账户头像

用户明确要求「从系统中获取头像」。新增 `icons.AccountAvatar()`（Windows 实现
放 `avatar_windows.go`，非 Windows 在 `avatar_other.go` 返回空），
`handleSelfIcon` 改为三级优先级：

1. `%ProgramData%\Microsoft\User Account Pictures\<用户名>.dat` —— 用户自己设置过的头像
2. 同目录 `user-192.png` 等 —— 系统默认头像（未设置头像时的占位图）
3. exe 图标资源 → 内嵌 `landeck.ico` 兜底（原有逻辑）

`.dat` 只在 `Size() > 0` 时才算数（实测未设置头像时该文件是 0 字节）。
`normalizeImage()` 会按魔数在文件前 512 字节里找 PNG/JPEG/BMP 的真实起点，
因为 `.dat` 可能带非图片前缀，直接整块返回会让浏览器解码失败。

实测这台机器：当前用户的 `<用户名>.dat` 是 0 字节（没设置过账户头像），
所以落到第 2 级 `user-192.png`，接口返回 2392 字节 `image/png`。

### 4. 详情页与列表头像不一致

`DeviceGridCard`（列表）传了 `iconSrc={client.selfIconUrl()}`，
但 `DeviceBanner`（详情页）只传了 `os`，没传 `iconSrc` ——
同一台设备在列表里是真实头像、点进来变成默认 OS 符号。
给 `DeviceBanner` 加 `iconSrc?` prop，由 `DeviceDetail` 传入
（`client?.selfIconUrl()`，`client` 可能为 null 故用可选链）。

### 5. 图标缓存策略从 max-age 改为 no-cache + ETag

排查第 3 项时发现一个真问题：服务端已经在返回新头像（2392 字节 PNG，
`Content-Type: image/png`），但手机上的 `<img>` 仍显示旧图标 ——
因为原端点带 `Cache-Control: public, max-age=86400`。

图标内容**会变**（用户换头像、agent 升级换 exe 图标），所以改成
`no-cache` + `ETag`：每次带 `If-None-Match` 回源重验证，
没变回 304（几乎零成本），变了立刻拿新图。用 ETag 而非 `Last-Modified`，
因为头像可能来自 `ProgramData` / 注册表，mtime 不一定可靠。

另外前端 `selfIconUrl()` 加一个 `v` 版本参数（`SELF_ICON_CACHE_VERSION`），
用来立刻打破**已经存在**的那些旧缓存 —— 服务端改策略管不到历史上按
`max-age=86400` 缓存下来的那份。改动头像来源时把这个版本号 +1 即可。

## Alternatives considered

- **抽屉保留 framer-motion，只去掉 backdrop-blur**：`measureScroll` 来自
  位移动画，不来自 blur；只去 blur 治不了本。放弃。
- **抽屉关闭动画保留滑出**：需要 AnimatePresence 延迟卸载，等于把
  framer-motion 再引回来。打开瞬间的卡顿优先于关闭动画的观感。放弃。
- **只删前端页面、保留后端接口**：用户选择了前后端一起删。且这两个端点
  没有其他客户端依赖。放弃。
- **用厂商/型号（Win32_ComputerSystem）匹配品牌 logo**：用户明确选了
  「读 Windows 账户头像」，且这台机厂商是 `Win element` 这类非主流值，
  内置品牌库覆盖不了。放弃。
- **把头像直接读成 base64 内嵌进设备信息 JSON**：会让每次 status 响应
  多几 KB，且 `<img>` 无法缓存。保持独立端点 + ETag。放弃。
- **前端不做版本参数、只靠服务端 no-cache**：服务端改策略无法让浏览器
  放弃历史上已按 max-age 缓存的那份。必须换 URL。放弃。

## Consequences

收益：
- 导航从 6 项减到 4 项，每项宽度从 217px 增到 326px，可点区域更大。
- 设备头像来自系统账户头像，列表与详情页一致。
- 图标内容变化能立刻生效（ETag 重验证 + URL 版本号双保险）。
- 少两条后端聚合接口。

代价与边界：
- 抽屉关闭时没有滑出动画（直接消失）。
- 未设置过 Windows 账户头像的机器会显示系统默认头像（人物剪影），
  这是「系统上本来就是这个人像」的真实反映，不是占位兜底。
- 非 Windows 平台不提供系统头像，直接回退 exe 图标 / 内嵌 logo。
- `SELF_ICON_CACHE_VERSION` 是手工维护的常量：将来再换头像来源要记得 +1。

## Testing

真机（1440×3200，density 600）实测：

- 导航项 `uiautomator dump` 只有 4 项：发现 / 本机 / 设备 / 设置。
- 设备列表截图 + 视觉确认：头像为系统默认账户头像（人物剪影），
  不再是原来的雷达图标。
- 详情页截图 + 视觉确认：同样的人物剪影，与列表一致；
  动作栏与状态栏无重叠。
- `self/icon` 接口：HTTP 200、`image/png`、2392 字节、`Cache-Control: no-cache`、
  带 `If-None-Match` 二次请求返回 **304**。
- `/api/v1/stats`、`/api/v1/activity` 均返回 **404**。
- 抽屉打开帧统计：90th 48ms / 95th 61ms / 99th 65ms；
  纯切页对照 90th 73ms / 99th 89ms —— 抽屉不比切页差，
  剩余长帧来自页面首次挂载的 React 渲染。
- `tsc --noEmit`、`go build ./...` 通过；笔记门禁 22 篇通过。