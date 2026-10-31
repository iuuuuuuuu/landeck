/**
 * AI 功能的缓存 key 构造器。
 *
 * 与 activityKeys.ts 同一纪律：key 必须带 host|port|token 身份维度。
 * AI 是按设备查的——调 LLM 的 agent 就是该设备的被控端，A 电脑配的模型
 * 和会话历史绝不能串到 B 电脑上。
 */
import type { Target } from './api'
import { cacheKey } from './queryCache'
import type { SummaryScope } from './aiApi'

type C = (Target & { token?: string }) | null | undefined

function ident(c: C): Array<string | number | undefined> {
  if (!c) return []
  return [c.host, c.port, c.token]
}

/** 对话会话（最近一次，切页/刷新后恢复） */
export function aiChatSessionKey(c: C): string {
  return cacheKey(['ai-chat-session', ...ident(c)])
}

/** 生成的总结（scope+日期锚定，重进页面直接回显上次结果） */
export function aiSummaryKey(c: C, scope: SummaryScope, date: string): string {
  return cacheKey(['ai-summary', scope, date, ...ident(c)])
}

/** AI 设置（表单回显用；保存后立即失效重拉） */
export function aiSettingsKey(c: C): string {
  return cacheKey(['ai-settings', ...ident(c)])
}
