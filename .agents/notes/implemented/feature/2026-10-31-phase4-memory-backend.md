# Agent Note: 屏幕记忆后端（截屏 + OCR + 文字检索）

Status: implemented

## Problem

四期 A 节（docs/design/phase4-memory-and-remote-desktop.md）：对齐 Hindsight 的
「屏幕记忆与搜索」——定时截屏 → OCR → 关键词搜回屏幕上出现过的字。
契约要点：默认关闭；GDI 截屏（BitBlt，多显示器拼接、长边 >1920 降采样）；
PowerShell + Windows.Media.Ocr 异步识别；shots 表复用 activity 的 SQLite；
四条 API（search/image/status/settings）；隐私命中（activity.IsPrivate）本 tick 跳过。

## Decision

- **包结构**：internal/memory/{settings, store, screen_windows/other, ocr_windows/other,
  ocrscript, collect, api}；Manager/循环/设置存储全部对齐 activity 的既有模式。
- **存储**：独立连接打开同一个 activity.db（WAL + busy_timeout），独立 shots 表。
  不跨包共享 *sql.DB——避免把两包焊死；两边写频（30s/60s）远够不着锁竞争。
  **额外加了 ocrNorm 列**（契约表没有）：OCR 输出常在字间插空格（「网 易 名 乐」），
  不归一的话搜「网易」永远 LIKE 不中（实测踩过）。原文照存（snippet 可读），
  检索词与 ocrNorm 双向去空白 + 小写。
- **隐私门**：截屏前 activity.SampleForeground → IsPrivate(当前规则)，命中则本 tick
  整个跳过（截图都不落盘——「截图存在本身」也是隐私）。
- **保留期**：默认 7 天（可配 1–90），启动后 5 分钟首跑 + 每小时清理（文件+行）。
- **路由**：search/image/status/settings(GET+PUT)。image 走 ?token=（protect 既有
  逻辑）+ ETag/304（对齐 appicon 模式）；id 只换文件名，绝对路径不出库。

## OCR 踩坑史（本任务 80% 的调试时间，三个独立的坑叠在一起）

1. **writeAtomic 把脚本 JSON 化**：Start 里把 ocrScript 传给 writeAtomic——它对
   **任何值**做 json.Marshal，字符串被整体编码（引号包裹、换行变字面 \n），
   PowerShell 拿到的是垃圾。修法：脚本裸写（os.WriteFile），writeAtomic 只用于 JSON 文件。
2. **PS5.1 stdout 编码随控制台状态漂移**：同一脚本，从 pwsh 里跑输出 UTF-8、
   从 Go exec 拉起（HideWindow / 无 flags）分别输出 GBK、双编码 UTF-8——
   [Console]::OutputEncoding=UTF8 也压不住。修法：**text 走 BASE64 输出**
   （纯 ASCII 对代码页免疫），Go 侧解码。
3. **按次拉起的 PowerShell 里 WinRT OCR 随机返回空 Lines**：同参数同时刻，
   pwsh 进程内跑稳定出文本（诊断脚本 9 行），子进程跑 textB64=null（15/15 连败、
   STA/MTA/有无 HideWindow 都一样）。根因没有完全查清（WinRT 会话状态相关），
   修法是换成**长驻 PowerShell worker**：stdin 收路径、stdout 回 JSON 行、
   WinRT 只初始化一次——空结果消失，且每张图省 300ms-1s 启动成本。
   代价：worker 常驻 ~60-80MB（仅功能开启时存在，关闭/停止即杀），
   与「按次起」的取舍在真机证据面前翻转（契约允许权衡并说明理由）。

调试手段（值得复用）：PowerShell 脚本加 **stderr 阶段标记**
（[Console]::Error.WriteLine('STAGE …')），Go 侧 CombinedOutput 一次定位卡点；
配合 cmd/ocrprobe 临时探针（复刻 agent 的 exec 调用）隔离父进程差异。
另：脚本体内**不能写中文注释**（PS5.1 无 BOM 按 ANSI 读，乱码注释会炸脚本，
README 事件的同族问题）。

## Alternatives considered

- **Tesseract/外部 OCR**：引入外部依赖与安装负担，WinRT 系统内置零依赖。放弃。
- **GDI 用 PowerShell System.Drawing**：常驻轮询场景进程启停不可接受，与
  foreground_windows 的 syscall 取舍同理。放弃。
- **FTS5 全文索引**：契约 v1 明确 LIKE 够用再升级。放弃。
- ** OCR 文本直接存（不归一）**：实测「网 易」搜不到。放弃（ocrNorm 列）。
- **多显示器逐屏截图**：契约 v1 明确拼接一张。放弃。

## Testing

memory 包 6 个单测（文件名契约格式/月份目录/snippet ±40 与省略号/shouldShoot
四分支/sanitize 区间/SQLite 往返含 LIKE 转义与 prune 边界）。故障注入两次精确变红：
snippet 窗口塌缩（首轮竟绿——测试是弱门禁，补了宽度下限断言后再注入才红，
门禁自身也经历了一次"假绿修正"）；prune 边界写成 <=（补了 ts==cut 边界行存活断言）。

真机 E2E（临时端口 18423，全新数据目录）：启用 → 15s 节奏截屏（440KB PNG、
1920 降采样、契约文件名）→ OCR 全中（ocrOk=2 fail=0，base64 还原后文本可读）→
search 命中归一关键词 → image 200 + ETag → If-None-Match 304 → 关闭后 20s 零新增
→ GET/PUT settings 往返。

## 附带接线

- rd.Register 已接入 server.go（agent-rd 的包，lambda 桥接同 ai.Register）
- 漏注册的 GET /api/v1/memory/settings 已补（处理器和路由当初都漏了，E2E 抓的）
- go.mod 新增 golang.org/x/image（纯 Go 缩放，CatmullRom）

## Consequences

收益（真机 E2E，临时端口 18423、全新数据目录）：

- 启用后 15s 节奏截屏：440KB PNG、长边 1920 降采样、契约文件名（unixMs-ms.png）、
  YYYY-MM 目录
- OCR（长驻 worker）：ocrOk=2 / ocrFail=0，base64 还原后文本为可读 UTF-8，
  与 pwsh 内直跑的结果一致
- search：归一化检索命中（查询「网易」命中含空格的「网 易 名 乐」截图）
- image：200 + ETag，If-None-Match 复验 304
- 关闭开关后 20s 零新增截图；GET/PUT settings 往返正确

代价与边界：

- 长驻 OCR worker 常驻 ~60-80MB 内存，**仅在功能开启时存在**；关闭/停止即杀
- OCR 文本质量取决于屏幕内容与系统语言包：无语言包 → NOLANG → 文本空、截图照存
  （ocrFail 不计）；Windows OCR 对暗色/低对比画面会输出乱码字符（含 U+FFFD），
  检索词需与屏幕实际文字一致——这是 Windows OCR 本身的识别质量，不是管线问题
- 非 Windows 平台：screen/ocr 均空实现，API 正常但采不到数据
- 首张截图在启用后最多等一个 intervalSec（ticker 模型），不是即时；
  如前端要「开启即截」，需加 nudge 通道（未做）
- 首次在线拉取之外，image/search 端点无缓存（每请求读盘/查库，量级可接受；
  若前端高频轮询再议缓存）
