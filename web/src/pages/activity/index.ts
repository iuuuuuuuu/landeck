/**
 * 活动统计页出口（一期统计页批）。
 *
 * 路由契约（web-shell 在 App.tsx 接线）。导出两套名字：
 * 带前缀的 Activity*Page 是最初约定的名字，不带前缀的是 web-shell 侧已采用的名字
 * —— 共享工作区里两边都在动，双导出让路由接线不再被命名牵制；tsc 会保证两套等价。
 *
 *   /activity/daily      → DailyPage   = ActivityDailyPage
 *   /activity/weekly     → WeeklyPage  = ActivityWeeklyPage
 *   /activity/monthly    → MonthlyPage = ActivityMonthlyPage
 *   /activity/all        → AllTimePage = ActivityAllTimePage
 *   /activity/categories → CategoriesPage = ActivityCategoriesPage
 *   /activity/memory     → MemoryPage    = ActivityMemoryPage
 */
export { default as DailyPage, default as ActivityDailyPage } from './DailyPage'
export { default as WeeklyPage, default as ActivityWeeklyPage } from './WeeklyPage'
export { default as MonthlyPage, default as ActivityMonthlyPage } from './MonthlyPage'
export { default as AllTimePage, default as ActivityAllTimePage } from './AllTimePage'
export { default as CategoriesPage, default as ActivityCategoriesPage } from './CategoriesPage'
export { default as MemoryPage, default as ActivityMemoryPage } from './MemoryPage'
