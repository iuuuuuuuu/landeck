# Agent Note: 四期集成——屏幕记忆 OCR 尺度根因、RD 版本门实时化、单位契约

Status: implemented

## Problem

四期（屏幕记忆 + 远程桌面）四批 teammate 各自交付全绿，Lead 集成实测暴露三类问题：

1. **屏幕记忆检索永远 0 命中**：capture/OCR 计数正常（shotsCount=3、ocrOk=3），库里 OCR 文本却是灾难（`0 0 m ． d " ] 30幻…`，只有「网易云音乐」「消息」零星存活）。
2. **远程桌面永远 demo 模式**：agent 已含 /rd/stream 且版本已升 1.0.19，viewer 仍显示演示图案。
3. **「最近截图 20737 天前」**：单位契约漏写导致两批各按理解实现。

## Decision 与根因

1. **OCR 乱码根因 = 降采样尺度，不是位图传递分叉**。Lead 最初假设「OCR 读的位图 ≠ 落盘 PNG」——**不成立**（OCR 本来就在读落盘文件）。agent-activity 探针实证：虚拟桌面 4608×1440（双屏拼接），契约的「长边降到 1920」把它压成 1920×600，每屏文字只剩 41%，Windows OCR 在该尺度全输出幻字。决定性对比：全分辨率 OCR 出 `Firefox/deepseek/网易云音乐` 等大量真实词，降采样版全灭。修法：**OCR 消费全分辨率临时文件**（识别后即删+孤儿清扫），落盘仍 1920（存档给人看、OCR 给机器读，分叉是刻意设计）。
2. **RD 版本门改实时源**：viewer 用设备存储里缓存的 `device.ver`（配对时的 1.0.18）做 demo 门，agent 升 1.0.19 后不同步——已升级的被控端被挡在演示模式。修为 `probeNode()` 免鉴权探测 /hello 的实时 ver（StatusSnapshot 根本没有 ver 字段，useLive 方案类型不过）。
3. **lastShotAt 统一毫秒**：A 节契约漏写单位，agent 发秒、前端按毫秒渲染 → 「20737 天前」。修在 agent 返回边界归一毫秒，且双源（db.stats 秒 / 会话毫秒）取大——重启后会话计数为 0，不能拿 0 盖掉库里的真实值。

## Alternatives considered

- **存档也存全分辨率**：磁盘占用 ×4（4608×1440 每张 ~1.2MB），人眼 1920 足够。放弃，双路径分叉加注释。
- **版本门放宽为「不看版本」**：老 agent（无 /rd/stream）会拿到连接失败而非友好降级。放弃。
- **前端兼容秒/毫秒双单位**：把不确定性留在前端 forever。归一在数据生产侧。放弃。

## Consequences

收益（真机实测）：

- 屏幕记忆全链路：启用（确认弹窗）→ 15s 截屏（440KB PNG、多屏拼接降采样）→ OCR 真词 → `search firefox` 3 条命中（snippet 带 Firefox/Agent2APl 上下文）→ image 200 → 页面真数据渲染（已截 409 张 · OCR 45/0）→ 关闭恢复隐私默认 + 测试数据清理。
- RD：`/rd/<id>` 真流（canvas 2560×1440、demo=false、connected=true、帧采样持续变化）、busy 语义（第二连接收 busy）、无害移动后会话健康。
- EOL：renormalize 后 files/mcp 的翻转不再出现（.gitattributes 生效），又一次翻转被 git checkout 秒杀。

代价与边界：

- Windows OCR 对暗色/低对比画面输出乱码字符（识别质量非管线问题）；snippet 会带噪声。
- 内存后端 OCR worker 常驻 60–80MB（仅开启时）；「开启即截」无 nudge 通道，首张最多等一个 interval。
- RD v1 无 H.264/音频/剪贴板；q60 1080p 实测 2.7MB/s@10fps（2560×1440 单帧 280KB）。

## Android 构建修复（Lead）

本地 Android 构建在标题栏落地后被**间接破坏**：titlebar-win 为 apply_window_chrome 的
4 个 user32 调用引入了 windows 0.61 直依赖，与 tauri 栈的 0.62 家族在 lock 里并存；
Windows 目标能编过（桌面端一直绿），**aarch64-linux-android 目标上
windows-future 0.2.1 x windows-core 版本错配**，IMarshal 缺失整包编不过——
直到四期重打 APK 才暴露（期间没有任何人跑过 android 目标构建）。

修法：apply_window_chrome 改**本地 extern "system" 声明**（4 个调用零依赖），
移除 windows 直依赖——0.61 家族从 lock 消失，Android 目标 check 通过。
教训：**跨目标构建（Android）要进例行验证**，只在桌面验证的依赖变更可以
悄悄弄坏别的目标一周不被发现。

APK：1.0.19/1000019，签名证书与历史逐字一致（覆盖安装可用）。

## Testing

- 屏幕记忆：agent-activity 6 单测 + 2 故障注入（其中一次抓到它自己的弱门禁——snippet 只断形状不断宽度，补下限断言后才真红）+ Lead 真机验收（屏上词命中 + 截图人眼比对）。
- RD：19 单测 + 3 故障注入 + Lead 真机 4 断言（进页/真流/语义/健康）。
- 单位回归：memory 测试随 lastShotAt 归一全绿。

## 关联

- 四期契约：[phase4 设计规范](../../../docs/design/phase4-memory-and-remote-desktop.md)
- 二期集成（归一层先例）：[二期集成](2026-10-31-phase2-integration.md)
