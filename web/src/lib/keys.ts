/**
 * 各类接口的缓存键构造器。
 *
 * 集中在这里的原因：键里必须带「身份维度」，只要有一处漏了 host/port/token，
 * 换设备就会命中上一台的数据 —— 那是最难察觉、后果最严重的一类 bug。
 * 统一用这些函数拼，比每处手写字符串安全。
 */
import type { AgentClient } from './api'
import { cacheKey } from './queryCache'

type C = Pick<AgentClient, 'target' | 'token'> | null | undefined

function ident(c: C): Array<string | number | undefined> {
  if (!c) return []
  return [c.target.host, c.target.port, c.token]
}

/** 系统信息（/system）：设备详情、文件页、设置页共用同一条缓存 */
export function systemKey(c: C): string {
  return cacheKey(['system', ...ident(c)])
}

/** 硬件信息（/hardware）：变化极慢 */
export function hardwareKey(c: C): string {
  return cacheKey(['hardware', ...ident(c)])
}

/** 开机统计（/uptime/history）：带 days */
export function uptimeKey(c: C, days: number): string {
  return cacheKey(['uptime', days, ...ident(c)])
}

/** 配对设置（/pairing）：含随机码与到期时间，时效短 */
export function pairingKey(c: C): string {
  return cacheKey(['pairing', ...ident(c)])
}

/** 已配对客户端（/clients） */
export function clientsKey(c: C): string {
  return cacheKey(['clients', ...ident(c)])
}

/** 定时任务（/schedules） */
export function schedulesKey(c: C): string {
  return cacheKey(['schedules', ...ident(c)])
}

/** 被控端参数（/settings） */
export function agentSettingsKey(c: C): string {
  return cacheKey(['agent-settings', ...ident(c)])
}

/** 文件根目录（/files/roots） */
export function fileRootsKey(c: C): string {
  return cacheKey(['file-roots', ...ident(c)])
}
