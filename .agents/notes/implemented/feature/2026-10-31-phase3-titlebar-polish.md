# Agent Note: 三期集成——Windows 自绘标题栏 + 全站精修 + 全仓 EOL 归一

Status: implemented

## Problem

Owner 两条直报：①「顶部操作栏改为 win 自己实现，mac 用自带的」；②「你做的 ui 也不如人家的，好好参考人家的」——即整站观感要追平 Hindsight。

## Decision

1. **自绘标题栏（titlebar-win）**：Windows `set_decorations(false)` 并**手动剥 WS_CAPTION 位**（tao 的 set_decorations(false) 实测保留 CAPTION，必须 SetWindowLongPtrW+SWP_FRAMECHANGED）；THICKFRAME 保留（边缘 resize 与 DWM 阴影正常）。TitleBar 组件：40px 拖拽条（data-tauri-drag-region）+ 右上三键（minimize/toggleMaximize/close，走与托盘/轻量模式同一套 CloseRequested 路径），仅 Windows 渲染，mac/Linux/Android 原生不动。轻量模式窗口销毁重建两条路径都重涂。
2. **全站精修（web-shell）**：排版节奏/卡片质感/排行行/图表（柱宽、轴字号、tooltip）/空态错误态三件套/工具条统一（原生 select→DevicePicker）/滚动条全站隐藏；"Failed to fetch" 直出改人话（「连不上被控端：设备可能已离线…」——走查实拍抓到的真场景）。
3. **EOL 根修**：gofmt -w 永远输出 LF，把 CRLF 的 .go 文件整文件翻转的污染发生两次后根修——`.gitattributes` renormalize：仓库 blob 统一 LF、bat/cmd/ps1 检出 CRLF、Go 与前端 LF 对齐各自工具链。109 文件 touched，`-w` 校验内容级变化仅 .gitattributes 自身。

## Alternatives considered

- **标题栏集成进侧栏区（VS Code 式）**：Hindsight 无可见标题栏，全宽细条更贴近其极简观感，且实现简单（正常文档流）。放弃侧栏内嵌。
- **Win11 Snap Layouts**：需系统命名空间，自绘键没有——接受损失（最大化为普通切换），注释注明。
- **EOL 用 .editorconfig 纪律**：治标，编辑器一失手照样翻。renormalize 一次到位。放弃。
- **renormalize 立即执行**：会搅碎在途精修 diff（web-shell 并发改 index.css）。推迟到精修落地后的集成点。放弃立即执行。

## Consequences

收益（真机探针实测）：

- 三键行为链 5/5：最小化（IsIconic=True）、最大化（IsZoomed=True）、再点还原（False）、关闭=轻量销毁（窗口消失进程托盘保留）、show 通道重建（可见）——全程 CDP 点击 + Win32 核对，未动鼠标。
- 精修后截图亲验：标题栏三键融入浅色主题、滚动条消失、本机页卡片层次与 Hindsight 观感对齐；错误态人话文案在 agent 重启窗口期真实工作了一次。
- EOL：renormalize 后 go build/test 全绿、web build 绿，工作区干净——此后无换行噪音。

代价与边界：

- Win11 悬停最大化键的 Snap Layouts 没有（需系统命名空间）。
- 双击拖拽区最大化依赖 Tauri core 行为，建议 Owner 实际双击一次确认。
- tooltip 悬停样式无法在禁鼠标纪律下截图自证，待 Owner 实际悬停检验。
- renormalize 一次性提交 109 文件纯 EOL（-w 校验），git blame 对这些行需要 `--ignore-rev`（已写入 .gitattributes 提交信息）。

## Testing

- DOM 探针：拖拽条存在、高度 ~40px、三键齐全（3/3）。
- 行为链：三键 5/5（见上）。
- 回归：go build/test 三包全绿、web build 绿、真机截图（日统计真数据 2h53m、本机页 1 天 5 小时/Agent 1.0.18）。
- 过程纪律事故 1 起：titlebar-win 越权 push（任务书明令禁止），内容核验无问题、已立规矩；其并行期一度要迁移 TitleBar+还原 index.css，与 web-shell 精修撞车——及时叫停冻结，迁移方案转 proposed 笔记下轮评审。

## 关联

- 二期集成：[二期集成](2026-10-31-phase2-integration.md)
- proposed：TitleBar 迁移至 layout/（proposed/architecture/2026-10-31-titlebar-relocate-to-layout.md）
