# Agent Note: 设备 logo 用被控端自身图标；设备卡快捷操作；详情页离线自动恢复；统计页底部与磁盘单位

Status: implemented

## Problem

用户这一轮提了五件事，都属于「看得到但用不上」：

1. 设备页希望能用**头像当设备 logo**（现在一律是 ⊞ 符号块），并加**快捷操作**。
2. 设备详情页打开时若设备还没连上，之后设备上线了**状态永远不刷新**，必须退回列表再进来。
3. 统计页数据多时**底部被顶到看不见**（被底部标签栏压住）。
4. 统计页磁盘合计显示成 **「1.3 KB」**（明显单位错）。
5. 安卓内存/核心数不准（16GB 显示成 8GB）。

## Root causes

- **logo**：`/apps/icon` 只按路径取图标，没有「本设备自己长什么样」的端点。
  而设备卡只有一个 OS 符号。
- **不刷新**：`useFetch(client.system)` 是**一次性拉取**。首次失败后 `sys.error` 有值，
  但没有任何人再触发它；`useLive` 的 WebSocket 只管实时数值，不管可达性。
- **底部被压**：`<main>` 的 `pb-32` 是固定 128px，而移动端标签栏是
  `固定定位 + h-14 + pb-safe`，在带 Home 指示条的机型上高于 128px，内容尾部被压住。
- **磁盘单位**：API 的 `disks[].used/total` 单位是 **GB**（`LiveStats` 就按 GB 显示），
  统计页却用 `bytes()` 当字节格式化 → 1.9 GB 变成「1.9 KB」。
- **安卓内存**：`/proc/meminfo` 的 SELinux 标签是 `proc_meminfo`，`untrusted_app` 读不到
  （adb shell 是 `shell` 域，能读，所以很容易误判"能读到"）。浏览器侧只能给
  `deviceMemory` 分档值（上限 8）。

## Decision

1. **新增 `GET /api/v1/self/icon`**：返回被控端自身图标。
   两级来源：先解析 exe 的 `RT_GROUP_ICON`，拿不到就用 `go:embed` 内嵌的图标。
   内嵌这一级是必需的 —— Go 编译出的 exe **没有**图标资源，只有 exe 那级会永远 404。
   该端点不依赖 `allowProcessKill`（设备身份不属于进程管理能力）。
2. **`DeviceAvatar` 支持 `iconSrc`**，`onError` 回退符号块；设备卡传入 `client.selfIconUrl()`。
3. **设备卡加快捷操作**：锁屏 / 关屏 / 睡眠 / 重启，前三个直接执行，重启走二次确认
   （与详情页语义一致）；离线或执行中禁用。
4. **详情页离线自动重试**：`sys.error` 存在且非鉴权失效时，退避重试 3s→6s→12s（封顶 12s），
   成功即停；`document.hidden` 时不重试，避免后台耗电。
5. **底部留白按真实标签栏高度算**：`pb-[calc(7.5rem+env(safe-area-inset-bottom))]`。
6. **磁盘单位改为 GB**：`合计 {used} / {total} GB`。
7. **安卓内存走 `ActivityManager.MemoryInfo`**：`MainActivity` 把 `totalMem` 等写成
   `files/device_profile.json`，Rust 的 `device_profile` 优先读它并用它覆盖。
   选文件交接而不是写 Kotlin 插件：插件要在 Rust builder + Kotlin 注解 + 权限清单三处配合，
   对一个只读字段过重；同进程文件交接更直接，也便于 adb 侧核对。

## Alternatives considered

- **只做 exe 资源解析**：Go 默认构建的 exe 没有图标资源 → 端点恒定 404，需求落不了地。放弃。
- **用 windres/rsrc 往 exe 里塞 `.syso`**：需要 C 工具链或第三方生成器，跨平台构建会碎；
  且改的是构建产物而非应用能力。改为运行时两级回退，更简单也更稳。
- **详情页定时轮询整个 system()**：本来就有 `useLive` 管实时数值，再无条件轮询浪费；
  只在**失败后**重试，成功即停。
- **给 `<main>` 加更大的固定 pb（如 pb-40）**：仍然会在不同机型上错位；必须把
  safe-area 算进去。
- **安卓内存改读 `/proc/self/status` 或 sysfs**：拿不到**总内存**这个量，只有进程视角；放弃。
- **内存读不到就显示浏览器的 8GB**：等于用假数据冒充 16GB 真机，比留空更糟。留空并说明原因。

## Consequences

收益：每台设备有真实 logo；设备页可直接做常用操作；详情页设备上线后自动恢复（实测 1.5s，
无需刷新）；统计页底部不再被压；磁盘单位正确；安卓内存拿到 16GB 真值。

代价与边界：
- `/self/icon` 的内嵌图标是**统一**的 LanDeck 标记（不是每台机器各自的 exe 图标），
  因为 Go 构建的 exe 没有图标资源；若将来给 exe 加了图标资源，会优先用 exe 的。
- `device_profile.json` 的路径按包名 `dev.landeck.app` 硬拼，**改包名必须同步改 Rust 侧**。
- 详情页重试最长间隔 12s，设备恢复后最多等 12s 才刷新（实测通常 1 个周期内）。
- 内嵌图标是位图生成，不是品牌资产；后续若有正式 logo 直接替换 `assets/landeck.ico` 即可。
