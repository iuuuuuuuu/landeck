# Agent Note: 「手机扫不到 PC」的三个独立根因（Android 本地网络权限 / Windows 防火墙 Block / 网段推断错误）

Status: implemented

## Problem

用户报告：同一局域网内手机扫不到 PC（PC 有线，手机同时连 2.5G+5G），
手动安装配对也提示「设备无响应，可能已离线」，且从发现页切页极卡。

这条问题此前被当成「扫描逻辑不好」反复优化（并发、超时、原生优先）都没有解决，
说明真正的原因不在扫描算法里。

## Root causes（三个，全部实测确认）

### ① Android 16 的本地网络保护（主因）

`targetSdkVersion=37`。Android 16 起，targetSdk ≥ 36 的应用**默认无法访问局域网**：
连本网段的 TCP/UDP 都被系统拦掉。证据链：

- 手机 shell 里 `curl http://10.168.1.115:8420/api/v1/hello` → **200**
- 同一时刻 App 内扫段 254 个地址 → **全部「连接失败」**
- PC 侧实时抓连接：扫描期间**没有任何来自手机的包**到达 8420
- 授权后：扫到 1 台；配对成功

修法：manifest 声明 `ACCESS_LOCAL_NETWORK`，并在 `MainActivity` 首帧后运行时申请
（Android 16 是运行时权限；旧系统忽略该声明）。

### ② Windows 防火墙的显式 Block 规则（直接导致「设备无响应」）

Windows 按**程序路径**生成防火墙规则。实测本机：

```
appdata\local\landeck\resources\landeck-agent.exe   Block(Public) / Allow(Private)
target\release\resources\landeck-agent.exe          Block(Private,Public)   ← 开发构建
agent\bin\landeck-agent.exe                         Block(Private,Public)   ← 开发构建
```

**Windows 的显式 Block 优先于 Allow**。所以：

- 用户装的是安装版（Private=Allow）→ 本来能通；
- 但当时 8420 被我这个**开发版** Agent 占着（Block）→ 手机必然超时，报「设备无响应」；
- 而本机浏览器走 127.0.0.1，完全不受影响 —— 这是我反复自测都"正常"的原因。

修法：安装包加 NSIS 钩子（`windows/firewall.nsh`），安装时删除历史 Block 规则并按真实路径
放行 TCP 8420 / UDP 8421 / TCP 8443，卸载时清理。

### ③ 首选网卡打分把 VPN 当成局域网（连带）

`local_ip` 返回 `192.168.192.75`（ZeroTier），不是真实的 `10.168.1.115`。
原因：打分给 `192.168.x` 加 +30（"家用路由器大多在这段"），而中文网卡名「以太网 2」
不匹配 `eth/en/em` 前缀，得不到有线加分 → ZeroTier 反超。

后果：前端兜底扫段会去扫 ZeroTier 的 /24，永远扫不到真网段的 PC。

修法：删掉按网段加分（网段是猜测，网卡类型才是证据），补 ZeroTier/Tailscale/WireGuard 等
隧道关键字罚分，并识别「以太网/本地连接」中文名。

## 另外两个同批修复

- **CSP 缺 `http://ipc.localhost`**：Tauri v2 的 IPC 走该地址，`connect-src` 没列它 →
  所有 `invoke()` 被拦（日志明确报 `theme_get ... blocked`），`local_ip`/`scan_lan` 全部失效。
- **探测失败原因被吞**：`probeNode` 把异常统一吞成 null，界面只能显示「0 台」。
  新增 `probeNodeDetailed` + `probeRange` 收集错误分布，界面直接显示
  「254 个地址全部失败（最常见：连接失败，共 254 次）」——这次能定位到根因靠的就是它。

## Decision

1. manifest + 运行时申请 `ACCESS_LOCAL_NETWORK`
2. NSIS 安装钩子清理/重建防火墙规则
3. `iface_rank` 去掉网段加分、补隧道罚分、识别中文有线网卡名
4. CSP `connect-src` 补 `ipc: http://ipc.localhost`
5. 手动添加支持「单台 / 整段 / 区间」+ 独立端口框 + 一键填本机网段 + 进度与停止
6. 发现页 60 秒内复用上次结果（不再每次切页整轮重扫）
7. 扫描参数如实显示（端口/并发/超时/网段），替换写死的「并发 64 · 8420/8443」

## Alternatives considered

- **继续调扫描并发/超时**：已调过两轮无效果；根因是系统级拦截，调参无效。放弃。
- **让用户手动关防火墙**：把配置负担推给用户，且用户不会知道有 Block 规则存在。改为安装器负责。
- **Android 侧绕过（native socket 全包 HTTP）**：LNP 权限一旦授予，WebView 与 native 都通，
  没必要把整个 API 层搬到 Rust。放弃。
- **保留 192.168 加分只补中文网卡关键字**：ZeroTier 的 192.168 仍会反超，
  且网段加分本身就是猜测。删除更彻底。

## Consequences

收益：手机在 Android 16 上正常扫描/配对；安装版用户不再被防火墙 Block 挡住；
桌面 `local_ip` 返回真实局域网地址；Tauri IPC 恢复；扫描失败时用户能看到原因。

代价与边界：
- `ACCESS_LOCAL_NETWORK` 首次启动会弹一次系统权限框，拒绝则无法扫描（这是系统要求，不可绕过）。
- 安装钩子只在**重装/升级**后生效；已经装过的机器若残留 Block 规则，需要重装一次或手动删除。
- 开发构建（`target/release/resources/` 等路径）仍会被防火墙拦，属预期；
  本地联调要么走安装版路径，要么手动加放行规则。
- 手动网段扫描是 HTTP-only，端口必须填对（默认 8420）。

## Verification

- 手机 shell → 安装版 Agent：`code=200 t=0.034`；开发版 Agent：`code=000`（超时）—— 证明防火墙因素
- App 内扫描：修复前 254/254 全失败、0 台；授权后 **1 台**，耗时 3.2s，无兜底扫段
- 配对：修复前「设备无响应」；修复后设备页显示「在线」+ 应用列表（含真实图标）
- 权限闭环：撤销权限后启动 → 弹「允许此应用访问本地网络设备」→ 点「始终允许」→
  `granted=true, flags=[USER_SET]`
- 切页：`dumpsys gfxinfo` 实测 Janky frames 0.08%、99 分位 17ms
