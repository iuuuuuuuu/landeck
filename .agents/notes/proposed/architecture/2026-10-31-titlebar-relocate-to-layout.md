# Agent Note: 提案——TitleBar 迁至 layout/，样式内联 tailwind，index.css 还原

Status: proposed

## Problem

二期 Windows 自绘标题栏（cad126f）落点与组件归属有摩擦：

1. `shell/TitleBar.tsx` 放在 shell/，但 shell/ 是 ui-polish 的并发精修面
   （PageHeader/CardToolbar 等卡内工具条家族）；TitleBar 是窗口级部件，
   语义上与 AppShell/AppSidebar 同类，归 `layout/` 更一致。
2. 标题栏样式（`.titlebar`/`.titlebar-ctl`/`.app-custom-tb` 布局补偿，49 行）
   落在 index.css——那是全站共享样式面，窗口级组件的专属样式放组件内
   （tailwind 类）更内聚，也让 index.css 对 ui-polish 的并发编辑面更小。

## Proposal

- `shell/TitleBar.tsx` → `layout/TitleBar.tsx`（内容不变）；
- 删除 index.css 的 49 行标题栏段，样式全部改为 TitleBar.tsx 内的 tailwind 类；
- `.app-custom-tb` 的布局补偿（aside top-50px / main pt-58px）改为
  `useWindowsDesktop()`（runtime.ts 新增，UA 判定）条件类：
  AppSidebar `top-[52px]`、AppShell 主列 `pt-10`；
- shell/index.ts 还原（去掉 TitleBar 导出）。

cad126f 已交付可用（样式在 index.css 有标记段），本提案纯属归属/内聚优化，无行为变化。

## Alternatives considered

- **维持现状（cad126f）**：可用、样式段有注释标记、不影响任何人；代价是 shell/ 的
  并发精修面里混进一个窗口级部件，且 index.css 49 行归属模糊。若 ui-polish 后续
  也在 shell/ 放窗口级组件，本提案价值下降。推迟到 ui-polish 批次结束后再判。
- **样式走 CSS Modules**：项目无先例，为一处引入新模式不值。放弃。

## Acceptance criteria

- TitleBar.tsx 位于 layout/，shell/ 下无 TitleBar 痕迹；index.css 无标题栏段；
- 全部样式为 TitleBar.tsx 内 tailwind 类（含 hover #c42b1c 关闭键、暗色适配）；
- tsc + pnpm build 绿；真机（Lead 部署）三键/拖拽行为与 cad126f 无差异。

## Risks

- index.css 与 shell/ 都在并发编辑窗口内，迁移时点必须等 ui-polish 批次结束
  （本轮因此冻结——relocate 已执行到一半随即还原，工作区已回 HEAD）；
- 布局补偿从全局 CSS 改为条件类后，靠 useWindowsDesktop 的 UA 判定，
  与 Rust 侧 cfg!(windows) 理论上可能不一致（WebView UA 恒带 Windows NT，风险极低）。
