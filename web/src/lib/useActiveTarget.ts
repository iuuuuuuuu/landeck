import { useMemo, useState } from 'react'
import { AgentClient } from './api'
import { DEFAULT_PORT } from './discovery'
import { useApp, type PairedDevice } from '../store/app'

/**
 * 本机伪设备：控制端和被控端经常就在同一台机器上，这时候文件 / 定时 / 活动
 * 也应该能直接操作「这台电脑」，而不是强迫用户先把自己配对一遍。
 *
 * 免令牌依据：Agent 对来自 127.0.0.1 的请求直接放行（allowLocalNoAuth），
 * 所以 token 留空即可；AgentClient 见到 local 会把 baseUrl 固定成
 * http://127.0.0.1:port/api/v1（不能用相对路径，Tauri 壳里 origin 是 tauri.localhost）。
 */
export const LOCAL_DEVICE: PairedDevice = {
  id: '__local__',
  host: '127.0.0.1',
  port: DEFAULT_PORT,
  tls: false,
  token: '',
  clientId: 'local',
  name: '本机（这台电脑）',
  os: 'windows',
  arch: 'amd64',
  ver: '',
  addedAt: 0,
  local: true,
}

/** 本机目标失败时给用户的解释：和「设备离线」区分开，否则用户会去查网线 */
export const LOCAL_DOWN_HINT = '这台电脑上还没有运行 LanDeck 被控端，或端口不是默认值。'

export interface ActiveTarget {
  /** 设备下拉用的列表：本机永远排第一位，后面才是已配对设备 */
  devices: PairedDevice[]
  /** 当前生效目标，永远有值（最差也是本机） */
  device: PairedDevice
  deviceId: string
  /** 切换目标：只影响当前页，不写全局 activeId */
  setDeviceId: (id: string) => void
  /** 当前目标是不是本机 */
  isLocal: boolean
  /** 已配对设备数量，0 表示下拉里只有本机 */
  pairedCount: number
  /** 已按 local 规则构造好的客户端（本机不带令牌，不会因缺令牌 401） */
  client: AgentClient
}

/**
 * 页面级的「当前目标」：已配对设备 + 本机，统一从这里取，页面不要再自己挑 devices[0]。
 *
 * 为什么选中项是页面内的状态、而不是直接读写 store 的 activeId：
 * activeId 被顶栏 DeviceSwitcher / 侧栏 / 设置页按「已配对设备」的语义消费，
 * 一旦把 `__local__` 写进去，那些地方只能回退到 devices[0]，顶栏会和本页对不上。
 * 所以这里只把 activeId 当默认值，切目标留在本页。
 *
 * 「本页覆盖值」用 { id, base } 记：base 是当时的默认值，默认值一变（顶栏切了设备、
 * 又配对了一台）覆盖就自动失效，页面跟着走 —— 也就是不需要任何 effect 去同步 state。
 */
export function useActiveTarget(): ActiveTarget {
  const paired = useApp((s) => s.devices)
  const activeId = useApp((s) => s.activeId)

  // 本机恒在第一位：没有配对任何设备时也保证有可用目标
  const devices = useMemo(() => [LOCAL_DEVICE, ...paired], [paired])

  // 默认目标：全局选中的已配对设备 → 第一台已配对设备 → 本机。
  // 有配对设备时优先用它，避免老用户升级后默认视图被切到本机。
  const fallbackId = useMemo(() => {
    if (activeId && paired.some((d) => d.id === activeId)) return activeId
    return paired[0]?.id ?? LOCAL_DEVICE.id
  }, [activeId, paired])

  const [override, setOverride] = useState<{ id: string; base: string } | null>(null)

  const selectedId =
    override && override.base === fallbackId && devices.some((d) => d.id === override.id)
      ? override.id
      : fallbackId

  const device = devices.find((d) => d.id === selectedId) ?? LOCAL_DEVICE

  // 只拿身份字段做依赖：设备列表被 markOk 之类改写时不必重建客户端、不必重发请求
  const { id, host, port, tls, token, local } = device
  const client = useMemo(
    () => new AgentClient({ host, port, tls, local }, local ? undefined : token),
    [host, port, tls, token, local],
  )

  return {
    devices,
    device,
    deviceId: id,
    setDeviceId: (next: string) => setOverride({ id: next, base: fallbackId }),
    isLocal: local === true,
    pairedCount: paired.length,
    client,
  }
}
