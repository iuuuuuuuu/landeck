/**
 * AI 三页入口：导出名即契约（App.tsx 的路由接线依赖这些名字）。
 * 与 activity/index.ts 同一模式——页面实现细节不泄漏进路由层。
 */
export { default as AiChatPage } from './ChatPage'
export { default as AiSummaryPage } from './SummaryPage'
export { default as AiSettingsPage } from './SettingsPage'
