import { useEffect } from 'react'
import { AgentClient } from './api'
import { DEFAULT_PORT } from './discovery'
import type { SystemInfo } from './types'
import { useApp } from '../store/app'

/** 与 store 里 defaultClientName() 的产物一致的"没设置过"特征 */
const PLACEHOLDER = /^(Windows PC|Mac|Linux PC|iPhone|iPad|Android 手机)$/

/**
 * 把「本机身份」的默认值纠正为这台电脑的真实名称。
 *
 * 之前在设置页看到的永远是 `Windows PC` —— 那是按 UA 猜出来的占位名，
 * 和扫描列表里显示的「公司电脑-M600」对不上，用户会以为自己改错了东西。
 * 这里在本机被控端可达时，用它的 deviceName 覆盖占位名；用户自己改过的不动。
 */
export function useLocalIdentity(): void {
  const myName = useApp((s) => s.myName)
  const setMyName = useApp((s) => s.setMyName)

  useEffect(() => {
    if (!PLACEHOLDER.test(myName.trim())) return
    let alive = true
    void (async () => {
      try {
        const client = new AgentClient(
          { host: '127.0.0.1', port: DEFAULT_PORT, tls: false, local: true },
          undefined,
        )
        const sys: SystemInfo = await client.system()
        const real = (sys?.name || sys?.hostname || '').trim()
        if (!alive || !real) return
        // 再次确认用户没在这期间自己改过
        if (PLACEHOLDER.test(useApp.getState().myName.trim())) setMyName(real)
      } catch {
        /* 本机没被控端就保持占位名，不打扰用户 */
      }
    })()
    return () => {
      alive = false
    }
  }, [myName, setMyName])
}
