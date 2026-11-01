# Agent Note: 域名记录（A2）可行性调研——浏览器当前 URL 的获取方案

Status: proposed

## Problem

Hindsight 默认开启「浏览器网站域名记录」：记录浏览的网站域名并参与分类
（YouTube→视频）。我们在二期把 `domainCapture` 砍掉了，现在要补。

核心难点：Windows 上拿「前台浏览器的当前 URL」没有干净的原生途径。
现有的 30s 前台采样只能拿到**窗口标题**（含页面标题，不含 URL），
TitlePatterns 分类只能吃到标题级信息。本文评估五条路径并给出推荐方案，
**只调研不实现**。

## Proposal

**推荐：浏览器扩展 companion（路径 2），MVP 只做 Chrome + Edge。**

扩展用 `chrome.tabs` API 拿当前激活标签的真实 URL（全生态最精确的来源），
通过 **localhost HTTP 推送**给 agent（`POST /api/v1/activity/domain`），
agent 存「每浏览器的最近域名」内存表；activity 采集循环在**前台应用是浏览器**时，
用该浏览器的最近域名做分类（域名规则扩展现有 `CategoryRule`，加
`DomainPatterns []string`——YouTube→影音 与现有 TitlePatterns 同一套机制）。

### 为什么是扩展而不是别的（摘要，详表见 Alternatives）

- 精度：`tabs` API 直接给完整 URL（含路径与查询参数），零猜测
- 成本：**推送模型**——扩展在标签切换/更新时上报（防抖 5s），agent 零轮询；
  30s 采样循环完全不感知这件事
- 隐私边界最清晰：扩展是用户显式安装的（商店页面写明只取激活标签 URL），
  比「读全部历史 SQLite」或「劫持流量」的侵入性低一个量级
- 一份 Chromium 扩展代码同时覆盖 Chrome 与 Edge（Edge Add-ons 用同一份包）

### 实现骨架（进程/文件/协议变更量级）

```
webext/landeck-domain/            # 新增，~150 行 JS + manifest
  manifest.json   MV3；permissions: tabs；host_permissions:
                  http://127.0.0.1:8420/*
  background.js   service worker：
                  tabs.onActivated / tabs.onUpdated(防抖 5s) /
                  windows.onFocusChanged
                  → fetch POST /api/v1/activity/domain
                    {url, title, browser:"chrome"}
agent/internal/httpapi/domain.go  # 新增，~60 行
  POST /api/v1/activity/domain
  鉴权：仅回环 + Origin 白名单 == chrome-extension://<商店发布后的固定 ID>
  （商店发布后扩展 ID 稳定，白名单即防「任意本机网页伪造上报」——
    这是本方案的安全支柱：无 Origin 校验的话，任何网页都能往 agent
    塞假域名污染统计）
  存内存表：browser → {url, domain, at}（30s 无更新过期）
agent/internal/activity/          # ~30 行
  CategoryRule 加 DomainPatterns []string（API 透传，老配置缺字段
  serde/default 兼容——与 lightweight_mode 同款做法）
  Classify 增加 domain 参数：前台是浏览器且该浏览器有最近域名时，
  先按 DomainPatterns 匹配域名，再落回 TitlePatterns/ AppPatterns
  （纯函数扩展，单测同款）
settings                          # domainCapture 开关并入 /activity/settings，
                                  # 默认 false（对齐 Hindsight 的默认行为口径：
                                  # 它默认开，我们默认关——隐私敏感功能默认关是
                                  # 本仓库的既定惯例，设置页一句话引导开启）
```

协议变更量级：一条新端点 + 一条白名单常量 + 分类纯函数加一个参数。
无 schema 变更（域名不落库，只影响分类与内存态；是否要把域名写进段/搜索
属 v2 决策）。

### 分期落地建议

- **MVP**：Chrome + Edge 同一份 MV3 扩展（商店发布一次、Edge 复用）；
  agent 端点 + DomainPatterns 分类 + domainCapture 开关。
  验收：浏览器切到 youtube.com → 月统计「影音」涨；切回 IDE → 「编程」涨。
- **v2**：Firefox 移植（WebExtensions 的 tabs API 同形，但 AMO 独立发布、
  鉴别 Origin=moz-extension://<uuid 不稳定> → 需换 native messaging 或
  动态配对）；无扩展时的降级（见 Alternatives 的连接表兜底）。
- **v2 可选**：域名级时长统计（当前只有「浏览器总时长 + 最近域名」）。

## Alternatives considered

| 路径 | 精度 | 资源成本 | 隐私边界 | 维护成本 | 结论 |
| --- | --- | --- | --- | --- | --- |
| **1. UI Automation 读地址栏** | 高（omnibox 文本即 URL，但未聚焦时部分浏览器不暴露） | UIA 树遍历 10-100ms+/次；复杂页面更糟；30s 一次可承受但走的是无障碍通道，某些站点会强制整页可恶化 | 读地址栏=含搜索词，与扩展同级 | **高**：Go 侧无成熟 UIA 绑定，go-ole 手写 COM vtable ~500 行脆弱代码；Chrome/Edge/Firefox 控件树与 automationId 各不相同，浏览器大版本更新可能静默破坏 | 备选。精度可以但工程脆弱度最高，MVP 不做 |
| **2. 浏览器扩展 companion** | **最高**（tabs API 直接给 URL） | 推送模型零轮询；agent 侧一个端点 | 扩展显式安装=明确同意面；Origin 白名单防伪造 | 低：tabs API 是 MV3 稳定面；代价是商店发布与双浏览器上架维护 | **推荐（MVP）** |
| **3. 连接表轮询（GetExtendedTcpTable）** | 差：多标签多连接、连接存活跨站点切换、QUIC 走 UDP 不在 TCP 表、CDN IP 无域名 | 每 30s 读一次 TCP 表（~ms 级，便宜） | 只见 IP 不见域名，比 URL 温和 | 低 | 兜底价值有限：既拿不到域名也无法对应「当前标签」，仅能给「浏览器开着哪些远端」的粗信号。v2 给 Firefox/无扩展场景当参考信号，不进分类主链 |
| **4. 代理/hosts 劫持** | 理论最高（全部流量可见） | 系统级代理栈，需自签 CA 解 TLS | **灾难级**：MITM 全部流量（含非浏览器、含凭证），杀软报毒，证书固定站点直接坏 | 极高且危险 | **否决**：隐私反模式，与「本地优先、数据只在本机」的产品立场直接冲突，无讨论余地 |
| **5. 读浏览器 History SQLite** | 低：是「最近访问过」不是「当前前台」；延迟与歧义大（浏览 50 个站，哪个是活跃的？） | Chrome 运行中 History 有锁——需复制文件再读（多数时候成功，偶发不一致）；每 30s 复制一次不可接受 → 降频到分钟级 | **极敏感**：整个历史库（含数年前记录）都被读，远比「从此刻起记录访问域名」侵入 | 中：Chromium 的 History schema 无正式兼容承诺，大版本可能变 | **否决为主路径**；作为「启动时校准最近域名」的补充可再评估，但 MVP 不做 |

补充事实（影响判断的生态现实）：

- 窗口标题里其实**已经**有页面标题（现有 title 已入库），TitlePatterns 已能
  部分分类——域名记录的增量价值在：① URL/域名比标题稳定（标题是站点自拟文案）；
  ② 域名规则比标题关键词可靠（youtube.com→影音 一条规则顶几十条标题关键词）；
  ③ 是未来「按站点统计时长」的地基
- MV3 service worker 有生命周期限制，但 tabs 事件会唤醒 worker，推送模型不受影响

## Acceptance criteria

- 浏览器切到 youtube.com 视频页 → 15-60s 内（事件推送即时，分类在下一个
  采样 tick 生效）月统计「影音」分类增长，段/明细可追溯到 youtube.com
- 浏览器切到 github.com → 「编程」（DomainPatterns: github.com→编程）
- 未装扩展 / domainCapture=false：行为与现状完全一致（TitlePatterns 兜底），
  无任何新网络行为
- 非浏览器前台（IDE 等）：域名表过期不参与分类，分类结果与纯 AppPatterns 一致
- 任意本机网页伪造 POST /activity/domain：因 Origin 不在白名单被 403
- 30s 采样循环的 CPU 占用不因域名功能增加（域名是查表不是轮询）

## Risks

- **商店发布**是 MVP 唯一的外部依赖：Chrome Web Store 审核需开发者账号（一次性 $5）
  与审核周期（数天）；审核意见可能要求隐私声明（只读激活标签 URL、不上传）。
  缓解：开发者模式拖装作为过渡（用户是我们自己人），商店并行走
- **Edge/Chrome 大版本变更 tabs API**：MV3 tabs 面极稳定，风险低；真变更也是
  全生态同时坏，社区修得快
- **Origin 白名单依赖商店发布后的固定 ID**：未发布前（拖装）ID 不稳定 →
  MVP 过渡期用「token 查询参数」（agent 启动时把 token 写进 pairing.json，
  扩展首次安装时用户手工粘贴一次）——两档都实现，商店上架后切 Origin
- **隐私观感**：截图功能（二期）+ 域名记录同时开启的观感压力——设置页两处
  都要写明「数据只在本机」，并且域名默认关
- 与屏幕记忆的隐私门共享：domainCapture 关闭时，/activity/domain 端点直接
  501（而不是收着不用），避免「开关关了但端点还活着」的暧昧状态
