import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { NodeInfo } from '../lib/types'
import { uid } from '../lib/format'

export interface PairedDevice {
  /** Agent 的设备 id */
  id: string
  /** 最近一次可达地址 */
  host: string
  port: number
  tls: boolean
  /** 配对令牌 */
  token: string
  clientId: string
  name: string
  os: string
  arch: string
  ver: string
  addedAt: number
  lastOkAt?: number
  pinned?: boolean
  /** 本机自身：不需要令牌，直接访问同源 API */
  local?: boolean
}

export interface Toast {
  id: string
  kind: 'ok' | 'error' | 'info'
  title: string
  desc?: string
}

interface AppState {
  devices: PairedDevice[]
  activeId: string | null
  toasts: Toast[]
  myName: string
  myId: string
  addDevice: (device: Omit<PairedDevice, 'addedAt'>) => void
  upsertFromNode: (node: NodeInfo, patched: Omit<PairedDevice, 'addedAt' | 'host' | 'port' | 'tls' | 'id' | 'name' | 'os' | 'arch' | 'ver'>) => void
  patchDevice: (id: string, patch: Partial<PairedDevice>) => void
  removeDevice: (id: string) => void
  setActive: (id: string | null) => void
  markOk: (id: string) => void
  toast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
  setMyName: (name: string) => void
}

function defaultClientName(): string {
  if (typeof navigator === 'undefined') return '我的设备'
  const ua = navigator.userAgent
  if (/android/i.test(ua)) return 'Android 手机'
  if (/iphone|ipad/i.test(ua)) return 'iPhone'
  if (/mac os/i.test(ua)) return 'Mac'
  if (/windows/i.test(ua)) return 'Windows PC'
  if (/linux/i.test(ua)) return 'Linux 设备'
  return '我的设备'
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      devices: [],
      activeId: null,
      toasts: [],
      myName: defaultClientName(),
      myId: 'web',

      addDevice: (device) => {
        const existing = get().devices.find((d) => d.id === device.id)
        if (existing) {
          set({
            devices: get().devices.map((d) =>
              d.id === device.id
                ? { ...d, ...device, addedAt: d.addedAt, name: device.name, lastOkAt: Date.now() }
                : d,
            ),
            activeId: device.id,
          })
          return
        }
        set({
          devices: [...get().devices, { ...device, addedAt: Date.now(), lastOkAt: Date.now() }],
          activeId: device.id,
        })
      },

      upsertFromNode: (node, patched) => {
        get().addDevice({
          id: node.id,
          host: node.ip,
          port: node.port,
          tls: node.tls,
          token: patched.token,
          clientId: patched.clientId,
          name: node.name,
          os: node.os,
          arch: node.arch,
          ver: node.ver,
          lastOkAt: Date.now(),
        })
      },

      patchDevice: (id, patch) =>
        set({ devices: get().devices.map((d) => (d.id === id ? { ...d, ...patch } : d)) }),

      removeDevice: (id) => {
        const rest = get().devices.filter((d) => d.id !== id)
        set({ devices: rest, activeId: get().activeId === id ? (rest[0]?.id ?? null) : get().activeId })
      },

      setActive: (id) => set({ activeId: id }),

      markOk: (id) =>
        set({
          devices: get().devices.map((d) => (d.id === id ? { ...d, lastOkAt: Date.now() } : d)),
        }),

      toast: (t) => {
        const item: Toast = { ...t, id: uid() }
        set({ toasts: [...get().toasts, item] })
        setTimeout(() => get().dismissToast(item.id), t.kind === 'error' ? 6000 : 3200)
      },

      dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

      setMyName: (name) => set({ myName: name }),
    }),
    {
      name: 'landeck.app.v1',
      partialize: (s) => ({ devices: s.devices, activeId: s.activeId, myName: s.myName, myId: s.myId }),
    },
  ),
)

export function useDevice(id?: string | null): PairedDevice | undefined {
  return useApp((s) => s.devices.find((d) => d.id === (id ?? s.activeId)))
}
