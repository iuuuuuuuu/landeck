# Agent Note: 一期集成——设备路径前缀击穿 SQLite，契约归一层收口双批实现

Status: implemented

## Problem

一期三个 teammate（agent 采集批 / 前端骨架批 / 统计页批）各自交付并自审全绿，Lead 集成实测时连续暴露三个只有**真机集成**才现形的问题：

1. **活动采集永远 unsupported**：landeck.exe 拉起的 agent 报 `state=unsupported`，
   手动运行同一 exe 却正常。
2. **统计五页在真实 agent 上全崩**：`Cannot read properties of undefined (reading 'length')`，
   而 mock 模式自审全绿。
3. **共享工作区 git index 撞车**（teammate 已互相撞过一次，本批第二次隐患被 activity-pages 拆分化解）。

## Decision

### 1. 设备路径前缀（双端修复）

Tauri 的 `resource_dir()` 在 Windows 返回 `\\?\C:\...` 规范化路径，
`agent_start_impl` 把它原样作为 `--data` 传给 agent。Go 标准库一切正常
（config/settings 都写成功了），**唯独 modernc/sqlite 对 `\\?\` 前缀直接打开失败**；
`openDB` 失败时 Manager 把 `supported` 强制置 false —— 于是采集永远 unsupported，
且 `activity.db` 根本没创建（这就是诊断锚点：settings 写成功了、db 不存在）。

修复双保险：

- lib.rs 新增 `clean_win_path()`：spawn 前剥掉 `\\?\` / `\\?\UNC\` 前缀（`\\?\UNC\server\share` 还原为 `\\server\share`）；
- store.go `openDB` 入口做同样归一——防御未来任何调用方再传带前缀的路径。

教训：**「Go 标准库能处理」不等于「所有第三方库能处理」**；探针要盯「哪个文件创建了、哪个没创建」。

### 2. 契约归一层（activityApi.ts）

崩溃根因：两个批各自实现了契约的**不同字段名**——agent 时间桶叫 `buckets`、类别叫
`category`（值是规则中文名，如「编程」，因为存量数据按它落库）；统计页按 spec 用
`slots` 和内置 key（`coding`/`other`…）。`catColor(undefined)` → 哈希函数读 `e.length` 炸。

在 `activityApi.ts` 加归一层，两端代码零改动：

- `normCat()` / `agentCat()`：中文规则名 ↔ 内置 key 双向映射（编程/终端→coding…自定义名透传）；
- `normalizeSummary/Rank/AppDetail/Categories/Settings`：buckets→slots（月视图 label 取日号、周视图取星期短标）、
  rank 的 `category`→`cat`、detail 的 `hours.hour`("00")→`hour:0`、groups `secs`→`sec`；
- `fetchSummary` 并行拉 settings 提供工作时段色带（agent summary 不带 workband）；
- `putCategories` 把前端平铺规则（app→key）重组为 agent 的 `CategoryRule[]`，
  按 category 分组合并 `appPatterns`、保留既有 id 防漂移、自建类别无规则也保留条目。

放弃的替代方案：改 agent 的 json tag 直接输出前端形状——存量库按中文名落库，改身份字段等于毁数据；
改前端页面适配 agent 字段——`cat`/`slots` 散在五个页面和全部图表组件里，改动面大且把 agent 形状泄漏进 UI 层。归一层是唯一改动面最小、契约显式化的位置。

### 3. 共享工作区 git 纪律（流程）

两个 teammate 同时 `git add`+`commit` 时 index 是全局的，后提交者会把对方的 staged 扫走。
activity-pages 撞车后 soft-reset 自拆；本批结论固化：**teammate 交付必须尽快用显式路径提交，
不许长挂 staged**；Lead 集成时核验每个提交的文件边界（本批四个提交逐一核验通过）。

## Alternatives considered

- **让 agent 用 bbolt/JSON 文件替代 SQLite 绕开路径问题**：治标不治本，`\\?\` 迟早打到别的库；路径归一是对的修法。放弃。
- **让 agent 改 json tag 输出前端形状**：见上，毁存量数据语义。放弃。
- **归一层放 agent 侧（agent 出前端形状）**：agent 是五平台单一产物，前端形状改一次 agent 要重发五端；
  归一放 web 侧随 WebView 即时生效。放弃。
- **集成时直接自己重写统计页**：activity-pages 的组件质量过关（懒加载/缓存/mock 降级都在位），
  缺的只是字段翻译，40 行归一层 vs 重写 2400 行。放弃。

## Consequences

收益（真机实测）：

- landeck 拉起的 agent：`state=collecting`、`activity.db` 正常创建，真实采样本机前台应用。
- 统计五页 + 现有六页：桌面 7/7、移动 390px 通过（无错误边界、无演示徽标、真数据渲染），
  月统计页真实数据全要素（堆叠柱、四张统计卡、双环图、侧栏状态位「采集中」）。
- 分类联动：加规则（sourin_spike→游戏）后 rank 立即重分类，还原后回到「其他」（3 分钟查询缓存过期后）。
- 资源：agent 采集 25 分钟 WS 24.5→38.3 MB（含 SQLite 页缓存增长），CPU 目测近零。

代价与边界：

- 归一层是**隐式契约**：agent 新增字段前端拿不到（好在 JSON 多字段无害）；类别改名映射表要随默认规则演进。
- rank/summary 的 3 分钟缓存意味着改分类规则后统计数字最多滞后 3 分钟——设计如此（读放大保护），已在验证脚本里绕行。
- `domainCapture` 归一恒为 false：agent 二期才做域名采集，字段先占位。

## Testing

- 故障注入路径上，采集模块 19 个单测（teammate 批，含两次注入证明会红）继续全绿。
- 集成级验证（Lead，无头 Chrome + 真实 agent + CDP）：加强断言（显式检测错误边界文本「加载失败」、
  页面关键词、`demo` 徽标缺席）桌面 7 页 + 移动 390px 全过；首轮弱断言曾把崩溃页误判 PASS
  （len 阈值 + canvas 存在性不可靠）——**UI 断言必须检测失败态本身**，这条已固化进验证脚本。
- 分类联动与缓存行为用 Python urllib（字节级 UTF-8）验证；PowerShell 5.1 控制台会把中文响应显示成
  `??`，字符串比较也随错误解码假失败——跨进程验证一律用 Python，不用 PS 的 ConvertFrom-Json。

## 关联

- 一期设计规格：[Hindsight 风格改版一期设计规格](../../../docs/design/hindsight-revamp-phase1.md)
- 落盘缓存（本批前端复用的基建）：[查询缓存落盘](../architecture/2026-10-29-query-cache-persisted-l2.md)
