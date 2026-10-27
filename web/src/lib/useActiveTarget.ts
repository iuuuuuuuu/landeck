import { useMemo, useState } from 'react'
import { AgentClient } from './api'
import { DEFAULT_PORT } from './discovery'
import { isPhoneOS } from './runtime'
import { useApp, type PairedDevice } from '../store/app'

/**
 * 本机伪设备：控制端和被控端经常就在同一台机器上，这时候文件 / 定时 / 活动
 * 也应该能直接操作「这台电脑」，而不是强迫用户先把自己配对一遍。
 *
 * 免令牌依据：Agent 对来自 127.0.0.1 的请求直接放行（allowLocalNoAuth），
 * 所以 token 留空即可；AgentClient 见到 local 会把 baseUrl 固定成
 * http://127.0.0.1:port/api/v1（不能用相对路径，Tauri 壳里 origin 是 tauri.localhost）。
 *
 * 注意：这个伪设备只在**能跑被控端的平台**（桌面）上成立。手机上 127.0.0.1
 * 是手机自己，那里永远没有 agent —— 详见 localTargetAvailable()。
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

/**
 * 「本机」这个目标在当前设备上是否成立。
 *
 * 实测踩过：手机端把「本机（这台电脑）· 127.0.0.1」排在第一位并默认选中，
 * 而手机上的 127.0.0.1 是手机自己，没有 agent，于是统计页一进去就
 * 「统计数据读取失败」，用户会以为是被控端坏了。
 * 手机/平板跑不了被控端，所以那里根本不该出现「本机」这一项。
 */
export function localTargetAvailable(): boolean {
  // 手机/平板：本机目标不成立
  if (isPhoneOS()) return false
  // 桌面壳与桌面浏览器：本机（127.0.0.1）上可能真的跑着被控端
  return true
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
  /** 当前设备上「本机」这个目标是否成立（手机上为 false） */
  localAvailable: boolean
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

  // 手机上不提供「本机」目标：那里的 127.0.0.1 是手机自己，没有 agent，
  // 默认选中它必然「读取失败」。桌面端保持原行为（本机恒在第一位）。
  const includeLocal = useMemo(() => localTargetAvailable(), [])
  const devices = useMemo(
    () => (includeLocal ? [LOCAL_DEVICE, ...paired] : paired),
    [includeLocal, paired],
  )

  // 默认目标：全局选中的已配对设备 → 第一台已配对设备 → 本机。
  // 有配对设备时优先用它，避免老用户升级后默认视图被切到本机。
  const fallbackId = useMemo(() => {
    if (activeId && paired.some((d) => d.id === activeId)) return activeId
    if (paired[0]) return paired[0].id
    // 没有配对设备：桌面回落到本机；手机没有本机可选，返回空串由下面兜底
    return includeLocal ? LOCAL_DEVICE.id : ''
  }, [activeId, paired, includeLocal])

  const [override, setOverride] = useState<{ id: string; base: string } | null>(null)

  const selectedId =
    override && override.base === fallbackId && devices.some((d) => d.id === override.id)
      ? override.id
      : fallbackId

  // 手机上一台都没配对时，devices 为空 —— 这里必须给出一个「无目标」的表示，
  // 不能让 device 变成 undefined 把调用方炸掉。用 LOCAL_DEVICE 占位但标记 local=false，
  // 调用方据 pairedCount===0 && !includeLocal 显示「先配对一台」的引导。
  const device = devices.find((d) => d.id === selectedId) ?? devices[0] ?? LOCAL_DEVICE

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
    localAvailable: includeLocal,
    client,
  }
}
