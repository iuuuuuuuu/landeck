import type { StatusSnapshot } from './types'

/**
 * 把 /status 的响应补成完整结构。
 *
 * 为什么需要：这台设备可能连的是**老版本 Agent**（字段少）、或者端口上根本不是
 * LanDeck（随便什么服务返回一段 JSON）。前端渲染层大量读 `status.cpu.percent`、
 * `d.percent.toFixed()` 这类深层字段，一旦缺一层就是
 * `Cannot read properties of undefined (reading 'percent')`，整页白屏。
 *
 * 原则：网络回来的一切都当不可信输入，在入口补全；渲染层因此可以安全直读。
 */
const num = (v: unknown, def = 0): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : def
}

const str = (v: unknown, def = ''): string => (typeof v === 'string' ? v : def)

export function normalizeStatus(raw: unknown): StatusSnapshot {
  const s = (raw ?? {}) as Record<string, unknown>
  const cpuRaw = (s.cpu ?? {}) as Record<string, unknown>
  const memRaw = (s.mem ?? {}) as Record<string, unknown>
  const netRaw = (s.net ?? {}) as Record<string, unknown>

  const perCore = Array.isArray(cpuRaw.perCore) ? cpuRaw.perCore.map((v) => num(v)) : []
  const loadRaw = Array.isArray(cpuRaw.load) ? cpuRaw.load : []

  const disks = Array.isArray(s.disks)
    ? s.disks
        .map((d) => {
          const item = (d ?? {}) as Record<string, unknown>
          return {
            mount: str(item.mount, '—'),
            fs: str(item.fs),
            used: num(item.used),
            total: num(item.total),
            percent: num(item.percent),
          }
        })
        .filter((d) => d.mount !== '—' || d.total > 0)
    : []

  const temps = Array.isArray(s.temps)
    ? s.temps.map((t) => {
        const item = (t ?? {}) as Record<string, unknown>
        return { name: str(item.name, 'sensor'), c: num(item.c) }
      })
    : []

  let battery: StatusSnapshot['battery'] = null
  if (s.battery && typeof s.battery === 'object') {
    const b = s.battery as Record<string, unknown>
    battery = {
      percent: num(b.percent),
      charging: Boolean(b.charging),
      timeLeftMin: typeof b.timeLeftMin === 'number' ? b.timeLeftMin : null,
    }
  }

  const procRaw = (s.processes ?? {}) as Record<string, unknown>
  const topRaw = Array.isArray(procRaw.top) ? procRaw.top : []

  return {
    time: str(s.time, new Date().toISOString()),
    cpu: {
      percent: num(cpuRaw.percent),
      model: str(cpuRaw.model),
      cores: num(cpuRaw.cores),
      threads: num(cpuRaw.threads),
      freqMhz: num(cpuRaw.freqMhz),
      perCore,
      load: [num(loadRaw[0]), num(loadRaw[1]), num(loadRaw[2])],
    },
    mem: {
      used: num(memRaw.used),
      total: num(memRaw.total),
      percent: num(memRaw.percent),
      swapUsed: num(memRaw.swapUsed),
      swapTotal: num(memRaw.swapTotal),
    },
    disks,
    net: {
      rxBps: num(netRaw.rxBps),
      txBps: num(netRaw.txBps),
      iface: str(netRaw.iface),
      ip: str(netRaw.ip),
      mac: str(netRaw.mac),
    },
    battery,
    temps,
    processes: {
      total: num(procRaw.total),
      top: topRaw.map((p) => {
        const item = (p ?? {}) as Record<string, unknown>
        return {
          name: str(item.name, '?'),
          cpu: num(item.cpu),
          memMb: num(item.memMb),
        }
      }),
    },
    uptimeSec: num(s.uptimeSec),
    bootTime: str(s.bootTime),
  }
}
