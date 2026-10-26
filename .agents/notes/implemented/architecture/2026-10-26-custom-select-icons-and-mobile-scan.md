# Agent Note: 自绘下拉、图标规格统一、手机端扫描并发收窄

Status: implemented

## Problem

用户第 7、13 条与手机卡顿反馈，背后是三个「用平台默认/用满资源」的选择：

1. **下拉框还是原生的**：`<select>` 的弹层由操作系统绘制，深色/浅色主题下都是一块白底系统菜单，
   与界面完全不搭，且无法加图标、无法改圆角。
2. **图标规格混乱**：侧栏 17px、移动底栏 19px、顶栏 15px，`strokeWidth` 全吃 lucide 默认的 2（偏粗）；
   选中态与未选中态在图标上没有区分；「统计」用的是 lucide 已废弃的别名 `BarChart3`。
3. **手机切走发现页非常卡**：扫描时前端会**并行**跑一遍 HTTP 扫段，兜底最多 1270 个地址、
   64 并发 fetch。用户离开页面后这些请求仍在排空/中止，socket 池和主线程被反复唤醒。
   而手机原生壳本来就有 unicast 扫描（Agent 直接回包给探测方），前端再扫一遍是重复劳动。

## Decision

1. **自绘 `Select`（`components/ui/Dropdown.tsx`）**，保持 `<option>` children 的调用约定，
   所以两个调用点（设备切换、定时动作）一行没改。能力对齐原生：点击外部/Esc/方向键/Home/End/
   回车选中/禁用项跳过/aria（combobox+listbox+option）；弹层走 portal + fixed 定位，
   放进 Drawer/Modal 里也不会被 overflow 裁掉；下方放不开自动向上弹。
   键盘处理**只挂在按钮上**（焦点始终在按钮），窗口级只兜底 Esc —— 两处都监听会重复触发一次选择（实测踩到）。
2. **图标规格收进 `nav.ts` 常量**：导航 18px、标题 16px、行内 14px，`strokeWidth` 统一 1.75；
   换掉 3 个不贴切的图标（本机 `Laptop→MonitorSmartphone`、统计 `BarChart3→ChartColumn`、
   活动 `Activity→History`），保留发现 `Radar`/设备 `Monitor`/设置 `Settings`。
3. **手机扫描只走原生**：原生有结果就完全不扫段；一台都没扫到才兜底，且只扫**一个 /24、
   单端口、8 并发、450ms**。桌面原生壳保持两条路并行（并发从 64 降到 24）。

## Alternatives considered

- **引入 Radix / shadcn**：用户允许引 UI 框架，但 Radix Select 也需要把 `<option>` 改写成它的
  `SelectItem`，两个调用点全要改；而本项目已有 framer-motion，自绘成本更低、包更小、
  tailwind token 直接可用。放弃引入。
- **保留原生 select 只换样式**：`appearance-none` 只能改触发器，弹层仍是系统绘制，治不了根因。放弃。
- **手机端也并行扫段「多一条路」**：正是卡顿根因；原生 unicast 已覆盖这条路径。放弃。
- **降低全局并发到 8**：桌面扫段会从 ~3s 变慢到十几秒，牺牲桌面体验换取移动端。改成按平台分档。
- **给图标加字符串映射表**：会把类型安全丢掉（拼错名字运行时才炸）。保持直接 import 组件。

## Consequences

收益：下拉框与主题完全一致且键盘可用；三处导航图标规格统一、语义更准；手机切页不再被请求拖住
（实测并发 64→8、切走后 1.5s 内新请求 1 条、在飞 0、4x CPU 降速下双 rAF 31ms）。

代价与边界：
- 自绘下拉要自己维护键盘与 a11y，后续新增特性（多选、搜索）需要在这一个文件里扩。
- `TITLE_ICON_SIZE` 只是约定常量，卡片标题图标仍由各组件自己传 size（ui 层的 SectionTitle 未改）。
- 手机若某 ROM 连 unicast 都限制，兜底只有单 /24，会漏掉跨网段；需手动填 IP。
- 桌面扫段并发 64→24，理论上比之前慢一点（实测 254 个地址仍在数秒内）。
