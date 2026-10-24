import { useCallback, useState } from 'react'
import type { AgentClient } from '../../lib/api'
import type { ActionResult } from '../../lib/types'
import { useApp } from '../../store/app'
import { errText, isAuthError } from './apiHelpers'

export interface ActionRunner {
  /** 正在执行的动作名；按钮用它切 loading */
  pending: string | null
  run: (
    action: string,
    params?: Record<string, unknown>,
    okTitle?: string,
  ) => Promise<ActionResult | null>
}

/**
 * 控制动作统一出口：pending 状态 + 成功/失败 toast + 401 上报。
 * 失败一律 toast error.message，不做静默吞错。
 */
export function useActionRunner(
  client: AgentClient | null,
  onAuthError?: () => void,
): ActionRunner {
  const toast = useApp((s) => s.toast)
  const [pending, setPending] = useState<string | null>(null)

  const run = useCallback<ActionRunner['run']>(
    async (action, params = {}, okTitle) => {
      if (!client) {
        toast({ kind: 'error', title: '设备未就绪', desc: '请先选择一台已配对的设备' })
        return null
      }
      setPending(action)
      try {
        const res = await client.run(action, params)
        if (okTitle) toast({ kind: 'ok', title: okTitle })
        return res
      } catch (e) {
        if (isAuthError(e)) onAuthError?.()
        toast({ kind: 'error', title: '操作失败', desc: errText(e) })
        return null
      } finally {
        setPending(null)
      }
    },
    [client, onAuthError, toast],
  )

  return { pending, run }
}
