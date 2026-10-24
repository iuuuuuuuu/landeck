import { ApiError } from '../../lib/api'

/** 401 代表令牌被吊销或过期：需要整页引导重新配对 */
export function isAuthError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401
}

export function errText(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error && e.message) return e.message
  return '操作失败，请稍后重试'
}

/** 把 401 从 useAsync 这类只透出 message 的通道里挑出来 */
export function isAuthMessage(message?: string | null): boolean {
  if (!message) return false
  return message.includes('401') || message.includes('令牌') || message.includes('配对失效')
}

/** 包一层：捕获 401 时先通知页面，再把错误抛回给原本的异步状态机 */
export function withAuthGuard<T>(task: Promise<T>, onAuthError?: () => void): Promise<T> {
  return task.catch((e: unknown) => {
    if (isAuthError(e)) onAuthError?.()
    throw e
  })
}
