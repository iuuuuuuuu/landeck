# Agent Note: 发现页卡顿与安卓扫不到 PC —— 都是「扫描没有边界」

Status: implemented

## Problem

两个现象，不同层，但共同点都是扫描这件事没有明确的"何时开始、何时停止、走哪条链路"：

1. **切走发现页极卡**：扫描任务活在 `useLanScan` hook 里，页面卸载时手上没有 abort 把手；
   每发现一台设备一次 `setState`、每 100ms 一次耗时 `setState`，几百次重渲染叠在同一个主线程上，
   切页时要排队处理这些更新。
2. **安卓扫不到同网段 PC**（PC 开着、同网络、桌面端正常）：安卓在未持有 `MulticastLock` 时，
   省电策略会丢 WiFi 广播/组播；同时手机若取到蜂窝/VPN 地址，据此推出的 /24 根本不是家里那段。

## Decision

1. **扫描生命周期收回页面自己管**：`abortRef` / `tickerRef` / `aliveRef` / `queueRef` 四个把手，
   `useEffect` 的 cleanup 里依次 `aliveRef=false` → `abort()` → `clearInterval` → 清缓冲。
   结果用 200ms 一次的 flush **批量一次 setState** 追加，进度与耗时同批提交。
   雷达与结果列表拆成 memo 子组件，进度跳动不再重画 SVG 和全部结果卡。
2. **安卓扫段改为「原生单播 + 定向广播」**：
   - `local_ip` 用**网卡打分**选地址：名称含 wlan/wifi `+100`，有线 `+20`，
     蜂窝（rmnet/ccmni/seth…）`-100`，VPN `-60`，虚拟网卡 `-40`，再叠加 `192.168.*` `+30`。
   - `scan_lan` 在安卓上把 socket **绑到 WiFi 地址**（`SO_BINDTODEVICE` 不可用时绑地址等效），
     目标 = 全局广播 + 各网卡定向广播 + WiFi /24 内**逐台单播**。
   - 单播是关键：Agent 回包本来就是 unicast 回探测方（`WriteToUDP(reply, addr)`），
     所以即使系统把广播丢了，单播这条路必通。
3. **前端兜底扫段**：拿不到本机 IP 且确实在原生壳里时，退化为 5 个常见私有 /24
   （192.168.1 / 192.168.0 / 192.168.31 / 10.0.0 / 172.16.0），且**只探 8420** ——
   否则手机会发 2500+ 请求，十几秒没结果，观感就是"卡住"。
   `isPrivateV4` 加严：排除 127/8、169.254/16、100.64/10（运营商 CGNAT，安卓蜂窝最常见）。

## Alternatives considered

- **给 `useLanScan` 加一个 abort 参数**：也能修，但扫描是本页独占的状态，
  多一层 hook 只是把"谁负责清理"这件事藏得更深。收回页面内更直白。放弃。
- **用 `IntersectionObserver`/路由事件在卸载时停**：间接，且仍要传 abort 把手。放弃。
- **安卓只加大广播轮次和监听时间**：治不了丢广播的根因（省电策略丢的是包，不是时间不够）。放弃。
- **只靠前端 HTTP 扫段，去掉原生扫描**：手机要发上千个请求，且页面源是 `http://tauri.localhost`，
  跨源到各 IP 还要处理 CORS/超时，慢且脆。原生单播更快更稳。放弃。
- **`SO_BINDTODEVICE`**：需要 root 权限，普通 App 用不了。绑地址等效且无权限要求。

## Consequences

收益：切页不再排队等扫描；手机上单播路径绕开广播丢失；桌面端行为不变。

代价与边界：
- 安卓上发送 3 轮 + 2000ms 收包窗口，扫描整体比桌面稍慢，但命中率优先。
- 前端兜底扫段是"猜网段"，如果用户家里是 `172.20.x` 这类冷门段且拿不到本机 IP，仍会漏。
  这种情况需要手动填 IP（页面已有入口）。
- 已删除失去引用方的 `web/src/components/scan/useLanScan.ts`。
- **仍需真机验证**：手机装新 APK 后扫本机 PC 的实际命中率；个别 ROM（华为/小米省电策略）
  若单播仍不中，需要加 `ACCESS_NETWORK_STATE` + MulticastLock（要写 Kotlin 插件，属新范围）。
- 桌面端回归已验：`smoke` 26/26、`local-check` 10/10，切走发现页 2 帧内可响应（实测 21–31ms）。
