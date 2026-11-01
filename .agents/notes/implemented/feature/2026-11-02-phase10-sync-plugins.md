# Agent Note: 十期集成——云同步真机双设备 E2E + 多语言静态打包根治

Status: implemented

## Problem

对标 Hindsight 的最后大件：A1 云同步（多机合并统计）、A4 插件系统、A3 主题导入、A5 六语言补全、A2 扩展上架文档。四批并发后 Lead 集成，集成期又暴露两类部署级问题。

## Decision

1. **A1 同步模型 = pull-merge-read**（agent-activity，三处必要调和）：合并键 (deviceId,start,app)+end 取晚（契约字面含 end 则「取更晚」无意义）；增量推改为 GET-merge-PUT 累计快照（WebDAV 无 append，纯增量 PUT 会把远端覆盖成空集——E2E 实测暴露）；内存 WebDAV 服务器做 E2E 载体（本机无 rclone，契约允许「或同类」）。rules 拉取合并 v1 未做（自动覆盖用户规则风险大，待定语义）。
2. **A5 双修复**：① main.tsx 改 `await initI18n()` 后再挂载——组件挂载晚于 `addResourceBundle` 不触发 react-i18next 重渲染（bindI18nStore 默认 false），晚到的语言资源让已挂载卡片永远停在 fallback 文案；② en/zh-TW 资源从懒加载 chunk 改**主包静态打包**（各 +15KB gzip）——消除懒加载时序面。
3. **A2 上架文档**（docs/release/browser-extension-store.md）：$5 账号、打包、素材、隐私合规、上架后 Origin 白名单切换。
4. **A4 插件 MVP**（web-rd）：manifest+权限白名单、Focus 番茄钟内置、市场 catalog 读取、无头 17 断言。

## Alternatives considered

- **同步走增量 PUT**：WebDAV 无 append/If-Match，纯增量 PUT 把远端覆盖成空集（E2E 实测 A 第二次同步后远端被清空）——改为 GET-merge-PUT 累计快照，远端单调不减。
- **懒加载语言资源 + 修订阅**（bindI18nStore:true）：能修但保留时序面；静态打包 +15KB gzip 一次买断。放弃懒加载。
- **rules 自动合并**：静默覆盖用户自定义分类规则风险大——拉取快照+UI 采纳的语义待定，v1 不做。

## Consequences

真机验收（全部亲眼）：

- WebDAV 双设备 E2E：wsgidav(9800) + 主 agent + 第二 agent 实例（9801/独立数据目录）——设备1 推 321 段真数据、设备2 拉 321 推 1、设备1 二次拉到设备2 的段、status.devices 列出对方；scopeAgg=all：本机 2864s → 汇总 2893s（合并正确）；rank 同构。
- 六语言：en 切换后设置页全英文（Appearance & startup / Start with Windows / Interface language）、ja/pt/es 实测生效。
- 插件：插件组+Focus 计时+市场+导入（web-rd 17 断言 + Lead 部署目验）。
- 主题导入：JSON 包导入即生效刷新保持（web-shell 真链路验证）。
- 隐私恢复：E2E 后同步关、临时目录清、双 agent 停一台。

代价与边界：

- **tauri-build 指纹不含 web/dist**：改前端必须 touch lib.rs 强制 cargo 重嵌——本轮反复「改了不生效」的总根源（耗掉约 2 小时才定位：主题卡裸 key 与静默 desc 中英文混渲染的「不可能组合」实为 exe 内嵌 UI 停在旧版）。
- rules 拉取合并待定；删除不传播（v1）；Google Drive 后置。
- 插件 v1 安装=浏览器导入（agent /plugins/install 后续批）；同源运行只装可信来源。

## Testing

- 全仓 8 包测试绿；sync 包合并三态/水位线/MKCOL/404/打码 + 内存 WebDAV 双设备 E2E + 故障注入（不可达→lastError 落盘且不影响采集）。
- Lead 集成 E2E（本机 wsgidav 9800 + 双 agent 真进程）：见上。
- 语言切换：设置→Settings→简体 往返 + 刷新恢复。
- 性能门禁/笔记门禁 43 篇/隐私扫描照常全绿。

## 关联

- 七期精致度：[七期](2026-11-01-phase7-polish.md)；A2 调研：proposed/feature/2026-11-01-domain-capture-feasibility.md
