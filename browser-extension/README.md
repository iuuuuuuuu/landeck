# LanDeck 域名记录（浏览器扩展）

把 Chrome / Edge 激活标签的**域名**推送给本机 LanDeck Agent，用于活动统计的网站域分类（如 youtube.com → 影音）。仅本机 localhost 通信，**不经过任何外部服务**。

对应设计：`.agents/notes/proposed/feature/2026-11-01-domain-capture-feasibility.md`（推荐路径 2：浏览器扩展 companion）。

## 安装（开发者模式拖装）

1. 打开 `chrome://extensions`（Edge：`edge://extensions`）
2. 右上角打开「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本目录（`browser-extension/`）
4. Chrome 与 Edge 用同一份包，各自装一次即可；扩展 ID 各自独立

## 配置

1. 扩展卡片 →「详情」→「扩展选项」（Options）
2. **Token**：从桌面端 **设置 → 隐私 → 域名记录** 开启后复制（agent 端 `domainCapture` 开关默认**关**，属隐私相关默认关闭）
3. Agent 地址默认 `http://127.0.0.1:8420`，本机部署没改过端口就不用动
4. 打开「启用域名上报」→ 保存 → 点「测试连接」确认能通

## 上报语义

- 触发：激活标签切换（`tabs.onActivated`）或页面加载完成（`onUpdated status=complete`）
- **防抖 5s**：连续切换在 5s 窗口内只推**最后一个**；另设 10s maxWait——持续每几秒切一次的高频浏览也会周期性上报，不会饿死
- 域名取 `new URL().hostname` 小写；默认剥 `www.` 前缀（可关）
- 推送：`POST {agentUrl}/api/v1/activity/domain?token=<TOKEN>`，body `{browser: "chrome"|"edge", domain, title}`
- 失败静默重试：指数退避 1s/2s/4s/…封顶 5 分钟，最多 5 次；不刷 console

## 已知边界

- **MV3 service worker 生命周期**：Chrome 会在闲置约 30s 后杀掉 SW；防抖定时器（5s）在窗口内通常安全，但**极端情况下**（点击后立刻闲置且被回收）可能丢一次防抖尾。重启浏览器/事件到来会自动恢复，agent 侧 30s 去重窗口容忍这类重复与缺口。
- **host_permissions 固定 8420**：MV3 下改 Agent 地址到其他端口需要改 manifest 的 `host_permissions` 后重载扩展（fetch 受 CORS 约束，agent 的 withCORS 按 Origin 放行，一般也能通，但不保证）。
- **只认 http/https**：`file://`、`chrome://` 等内部页面不上报。
- **隐私**：只上报域名 + 页面标题，不读页面内容、不读历史记录；开关关闭时扩展完全不动。
- Firefox 不在本期（WebExtensions 同段但 Origin 校验机制不同，见可行性笔记 v2 节）。
