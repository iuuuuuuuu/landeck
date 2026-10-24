import { ApiError } from '../../lib/api'

/** 人话错误映射：API 错误码 → 用户能理解的提示 */
export function apiErrorMessage(e: unknown, fallback = '请求失败，请稍后重试'): string {
  if (typeof e === 'string') return e
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'timeout':
        return '设备无响应，可能已离线'
      case 'network':
        return '连接失败，请确认设备在线且在同一局域网'
      case 'rate_limited':
        return '尝试过于频繁，请等 1 分钟再试'
      case 'invalid_key':
        return '密钥不正确或已过期'
      case 'unauthorized':
        return '令牌已失效，请重新配对'
      case 'forbidden':
        return '当前角色没有该操作权限'
      case 'unsupported':
        return '当前平台不支持这个操作'
      case 'not_found':
        return '接口不存在，Agent 版本可能过旧'
    }
    if (e.status === 401) return '令牌已失效，请重新配对'
    return e.message || fallback
  }
  if (e instanceof Error) return e.message || fallback
  return fallback
}

export function isAuthError(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 401 || e.status === 403)
}
