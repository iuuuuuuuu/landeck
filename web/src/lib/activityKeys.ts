/**
 * 活动统计的缓存 key 构造器。
 *
 * 与 lib/keys.ts 同一纪律：key 必须带 host|port|token 身份维度，漏一个就会
 * 把 A 设备的统计当成 B 设备的。不直接放进 keys.ts 是因为那是本次
 * activity-pages 与 web-shell 的文件分界（web-shell 拥有 keys.ts），避免同文件冲突。
 */
import type { Target } from './api'
import { cacheKey } from './queryCache'
import type { Scope } from './activityApi'

/**
 * 身份来源：直接用 Target + token（活动 API 层的新签名）。
 * 不再从 AgentClient 挑字段 —— 本机伪设备（PairedDevice）没有 target 包装。
 */
type C = (Target & { token?: string }) | null | undefined

function ident(c: C): Array<string | number | undefined> {
  if (!c) return []
  return [c.host, c.port, c.token]
}

/** 统计汇总（含 demo 标记一起缓存，TTL 与服务端对齐 3 分钟） */
export function activitySummaryKey(c: C, scope: Scope, date: string): string {
  return cacheKey(['activity-summary', scope, date, ...ident(c)])
}

/** 应用/分类排行 */
export function activityRankKey(c: C, scope: Scope, date: string): string {
  return cacheKey(['activity-rank', scope, date, ...ident(c)])
}

/** 应用详情 */
export function activityAppKey(c: C, app: string, date: string): string {
  return cacheKey(['activity-app', app, date, ...ident(c)])
}

/** 分类规则 */
export function activityCategoriesKey(c: C): string {
  return cacheKey(['activity-categories', ...ident(c)])
}

/** 采集设置 */
export function activitySettingsKey(c: C): string {
  return cacheKey(['activity-settings', ...ident(c)])
}
