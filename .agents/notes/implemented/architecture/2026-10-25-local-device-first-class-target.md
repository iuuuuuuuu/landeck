# Agent Note: 「本机」从「一台设备」升格为一等目标

Status: implemented

## Problem

用户在**另一台**电脑上装了 v1.0.6，反馈：

- 「文件」「定时」「活动」三页看不到本机，只有已配对设备（他那台没配对过任何设备，于是三页全是死胡同）；
- 「统计」页对本机是空白；
- 「发现」页扫不到自己（本机被排除），但用户想看的恰恰是本机；
- 安卓上「本机」页弹「手机上不能启动本机被控端」，且手机上看不到任何统计；
- 硬件信息占的空白太多。

根因是一致性缺失：**本机在每页的实现各不相同**。
统计页有 `LOCAL_DEVICE` 常量、本机页有另一套、文件/定时/活动页则完全没有，
于是"能不能看到本机"取决于你打开哪个页面。

## Decision

1. **抽出 `useActiveTarget()`**（`web/src/lib/useActiveTarget.ts`）作为唯一入口：
   返回 `{devices, device, deviceId, setDeviceId, isLocal, pairedCount, client}`，
   其中 `devices` 恒把本机排在第一位，`device` 永不为 null。
   - 默认目标优先级：`store.activeId`（且确实是已配对设备）→ 第一台已配对 → 本机。
     **刻意不默认本机**，否则老用户升级后视图被切走。
   - 本机的 `AgentClient` 不带令牌（靠 Agent 的 `allowLocalNoAuth`）。
   - `client` 的依赖只取 host/port/tls/token/local，设备列表被 `markOk` 改写时不重建、不重发。
   - `'__local__'` **不写入** `store.activeId`：TopBar/Sidebar/DeviceSwitcher 都按
     "已配对设备"语义消费它，写进去会让顶栏与本页打架。
2. **手机（含手机浏览器）走 `PhoneSelfPanel`**：手机跑不了被控端，
   「本机」对它只能是"这台手机自己的信息"。数据全部来自 Web API
   （`navigator.hardwareConcurrency` / `screen` / `storage.estimate()` 等），拿不到就显示「不可用」。
3. **硬件面板去掉页签、密排**：栅格 `sm:grid-cols-2 2xl:grid-cols-3` + `items-start`，
   组内单列、行高 `text-[12px] leading-tight`，高度跟随内容（不再被左侧卡片拉成等高空盒）。
4. **文件根枚举全部盘符**：`GetLogicalDrives` 位掩码，而不是只取 `%SystemDrive%`。

## Alternatives considered

- **每页各自实现本机**（改造前的状态）：正是这次 bug 的成因。放弃。
- **把本机做成真正的 store 设备**（写进 `devices`）：会污染配对语义 —— 它没有 token、
  不能解绑、不该出现在备份里，且所有消费 `devices` 的地方都要加特判。放弃。
- **手机端也渲染桌面视图、只是隐藏启动按钮**：手机拿不到任何 agent 数据，
  隐藏按钮后剩下一屏破折号，等于告诉用户"这页坏了"。放弃。
- **靠 `isMobileLike()`（含触摸判定）判断手机**：实测踩坑 —— 带触摸屏的 Windows 笔记本
  会被判成手机，桌面用户看到手机面板。改为只看操作系统（`isPhoneOS()`）。
  触摸能力与"能不能跑被控端"根本不是一回事。
- **硬件组内保持两列**：宽屏下组已经并排了，组内再分两列会把「核心 / 线程 8 / 16」挤碎。放弃。

## Consequences

收益：本机在六个页面（本机/文件/定时/活动/统计/发现）语义统一；手机有专属视图；
硬件区在 1440 宽下 2 列、1920 宽下 3 列，14 个分组的纵向跨度从单列约 1200px 降到 713/541px。

代价与已知边界：
- 三个页面之间**不共享**本机选中项（选择只留在页内），代价是切页回到默认目标。
  要全局共享需要同时改 TopBar/DeviceSwitcher/Settings，未做。
- 本机固定用 `DEFAULT_PORT`（8420）；用户改过被控端端口时，只有「本机」页有端口输入框，
  文件/定时/活动页拿不到自定义端口。
- 手机端的 `navigator.deviceMemory` / `connection` / `getBattery()` 在 Android WebView 与
  iOS WKWebView 里通常不存在，这些卡片会稳定显示「不可用」——这是 Web 平台限制，不是 bug。
- 手机端「发现」扫不到 PC 的根因另见扫描相关笔记（走原生单播而非前端 HTTP 扫段）。
