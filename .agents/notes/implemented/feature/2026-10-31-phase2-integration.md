# Agent Note: 二期集成——图标路径语义、契约双漂移、持久缓存毒数据防线

Status: implemented

## Problem

二期（图标/AI 三件套/采集设置/数据管理）五个 teammate 各自交付全绿，Lead 集成实测暴露三类只有拼装才现形的问题，外加一条用户直报（「图标没有 icon」「部分功能未实现」）：

1. **排行里全是首字母块**：现有 `/apps/icon?exe=` 要求绝对 exe 路径（防任意文件探测的安全设计），统计页只有**应用名**——全部 404。
2. **AI 总结页点击生成后崩**：`Cannot read properties of undefined (reading 'replace')`，且崩在**加载期**而非点击后（持久缓存毒数据），两轮修复才收口。
3. 上报的「404 无 CORS」「`??` 类别」经查证均为误报（PS 控制台编码 / Origin 门控误解），不再展开。

## Decision

1. **图标语义翻转：路径换名字**。采集循环本就持有前台进程 exe 路径；新应用首次见到时**异步**提取（`icons.Extract`，不进 30s 热路径），按 `normalizeApp` 名落盘 `appicons/<name>.ico`。新端点 `GET /activity/appicon?name=` 只按**已缓存应用名**出图——名字只是内存缓存键，零文件系统访问，不重开探测面。磁盘扩展名是 `.ico` 不是 `.png`（Extract 返回 ICO 字节，名实相符优先），HTTP 层 Content-Type 正确即可。图标随使用逐个补齐，未缓存应用保持首字母块降级。
2. **AI 契约双向容错**：agent-ai 的 summary 返回 `{markdown}`，ai-pages 契约写 `{content}`。在 aiApi 归一：`r.content ?? r.markdown ?? ''`。教训：契约文字（spec 第 5 节）没覆盖 AI 组，两批各按理解实现——**归一层必须在两侧实现完成后由集成者核对真实响应形状**，不能信契约文本。
3. **持久缓存毒数据防线**：预修复版把 `{content: undefined}` 写进了 12h 落盘缓存（`landeck.querycache.v1`）。API 层修复救不了已落盘数据——SummaryPage 读取处加形状防线：`cached && typeof cached.content === 'string'` 才算命中，非法形状当没有缓存。原则：**queryCache 的持久层读回即不信任**（写侧校验过了，读侧仍要再校验——版本演进/契约漂移都可能产生旧形状）。
4. **404 CORS 与 `??` 类别均不修**（查证为误报）：`withCORS` 是 Origin 门控，浏览器跨域必带 Origin，实测 404+Origin 带 `ACAO:*`、OPTIONS 204；未命中规则 agent 实测返回「其他」，`??` 是 PS 控制台对中文的显示伪影。**跨进程验证一律 Python/字节级**，这条教训第二次出现。

## Alternatives considered

- **图标端点按名字即时解析 exe 路径**（注册表 App Paths / Start Menu 索引）：每次请求都要做系统级查找，攻击面（名字→路径解析规则）和维护成本都大；采集时顺手提取是零额外探测。放弃。
- **AI 契约改成 agent 返回 `{content}`**：agent 已按自己实现写了 15 个测试，改动面等价，但前端 Two 处调用点更少——归一放 aiApi 一行，风险更低。放弃改 agent。
- **清毒数据用 STORAGE_KEY 版本号 bump**：会清掉用户全部缓存（含活动统计 5 分钟热数据），为一条毒数据全清不划算。放弃，选形状防线。

## Consequences

收益（真机实测）：

- 图标：`appicons/landeck.ico` 18136B 提取成功、`/activity/appicon?name=landeck` 200 `image/x-icon`；排行内联图标随应用获得前台时间逐个补齐。
- AI 端到端：UI 点「生成总结」→ agent 组 prompt（669 字符上下文）→ LLM → markdown 渲染全链路通（本地 mock LLM 验证，未配置时 400 `ai_not_configured` 引导卡）；chat 收发 2s 内出回复；带毒缓存下防线降级为空态后再生成成功。
- 设置/数据管理：PUT 部分更新往返、`clear` 缺省 400 防误清、导出 JSON/CSV 均真跑通过。
- 全页回归 9/9（AI 三页 + 分类管理新卡 + 抽样四页）。

代价与边界：

- 图标仅对**新二进制上线后获得前台时间**的应用生效，历史段里的应用要等再次被使用；electron 系应用 exe 图标质量参差。
- AI 配置明文 key 只存 agent 本地（GET 打码），本期无流式输出（长生成时 UI 只有转圈，注释已注明 SSE 二期）。
- 侧栏「屏幕记忆」仍 disabled（三期截图 OCR）。

## Testing

- API 全链路（Python，字节级 UTF-8 断言）：AI 配置打码往返、summary/chat 经 mock LLM、未配置 400、导出 JSON/CSV、clear 防误触、settings 部分更新不波及他字段、appicon、404+Origin CORS、OPTIONS 预检——23 项断言（首轮 3 项 FAIL 全部triage：2 项测试自身错误、1 项真缺陷已修）。
- UI 端到端（无头 Chrome + CDP）：9/9 页面回归 + AI 总结「点击生成→渲染」+ chat「输入→发送→回复」交互级验证。
- 三份 teammate 自审均以 build/test 全绿交付；Lead 集成再抓出 2 个真缺陷（字段漂移崩渲染、持久缓存毒数据）——**批间集成验证不可省**。

## 关联

- 一期集成（设备路径前缀/契约归一层）：[一期集成](../architecture/2026-10-31-phase1-integration.md)
- 持久缓存基建：[查询缓存落盘](../architecture/2026-10-29-query-cache-persisted-l2.md)
- 二期设计来源：[Hindsight 风格改版一期设计规格](../../../docs/design/hindsight-revamp-phase1.md)
