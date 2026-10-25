import { useCallback, useEffect, useState } from 'react'
import {
  BatteryMedium,
  Cpu,
  HardDrive,
  Info,
  RefreshCw,
  Smartphone,
  Wifi,
} from 'lucide-react'
import { Badge, Button, Card, ProgressBar, SectionTitle, Stat } from '../ui'
import { bytes } from '../../lib/format'
import { collectDeviceSelf, readDeviceSelfSync } from '../../lib/deviceSelf'
import type { DeviceSelfInfo, SelfNetwork } from '../../lib/deviceSelf'

/** 网络类型：Network Information API 给的是 4g/3g 这种代号 */
function netLabel(t: string | null): string {
  switch (t) {
    case 'slow-2g':
      return '2G（极慢）'
    case '2g':
      return '2G'
    case '3g':
      return '3G'
    case '4g':
      return '4G'
    default:
      return '未知'
  }
}

/** --x 占位：拿不到的字段统一这么显示，不要写「错误」 */
function Dash({ text = '不可用' }: { text?: string }) {
  return <span className="text-[13px] font-normal text-faint">{text}</span>
}

/**
 * 手机「本机」页：展示这台手机自己的信息。
 *
 * 手机上跑不了被控端（agent_start 是桌面端专属命令，移动端只会返回 Err），
 * 所以这一页不再请求 Agent，而是用 Web API 读设备自身 —— 屏幕、核心数、
 * 存储、网络、电池都是浏览器/WebView 就能给的，不需要任何后端。
 */
export function PhoneSelfPanel() {
  // 同步字段先出图，避免一片骨架；异步字段（存储/电池）到位后替换
  const [info, setInfo] = useState<DeviceSelfInfo | null>(() => readDeviceSelfSync())
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setInfo(await collectDeviceSelf())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const screen = info?.screen ?? null
  const net: SelfNetwork | null = info?.network ?? null
  const storage = info?.storage ?? null
  const battery = info?.battery ?? null
  const storagePercent =
    storage && storage.quota > 0 ? Math.min(100, (storage.usage / storage.quota) * 100) : null

  return (
    <div className="space-y-3">
      {/* 顶部身份条：手机自己，没有「实时/未连接」——这里根本没有连接对象 */}
      <Card className="flex flex-wrap items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] border border-line bg-gradient-to-br from-[#22d3ee]/25 to-elevated text-cyan">
          <Smartphone size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[16px] font-semibold text-fg">{info?.model ?? '当前设备'}</h2>
            <Badge tone="cyan" dot>
              当前设备
            </Badge>
            <Badge tone="neutral">{info?.system ?? '未知系统'}</Badge>
          </div>
          <p className="mt-1 text-[12px] text-muted">
            这些数据由手机自身读取，不需要被控端
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void load()} loading={loading}>
          <RefreshCw size={14} className="mr-1" />
          刷新
        </Button>
      </Card>

      {/* 系统与屏幕 */}
      <Card>
        <SectionTitle
          title="设备"
          desc="型号与屏幕参数，来自浏览器环境"
          icon={<Smartphone size={16} />}
        />
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="型号"
            value={<span className="text-[13px]">{info?.model ?? '—'}</span>}
            hint={info?.os === 'android' ? 'Android Build 型号' : undefined}
          />
          <Stat label="系统" value={<span className="text-[13px]">{info?.system ?? '—'}</span>} />
          <Stat
            label="分辨率"
            value={
              screen ? (
                <span className="num text-[13px]">
                  {screen.width} × {screen.height}
                </span>
              ) : (
                <Dash />
              )
            }
            hint={screen ? `DPR ${screen.dpr}` : undefined}
          />
          <Stat
            label="物理像素"
            value={
              screen ? (
                <span className="num text-[13px]">
                  {Math.round(screen.width * screen.dpr)} × {Math.round(screen.height * screen.dpr)}
                </span>
              ) : (
                <Dash />
              )
            }
            hint="CSS 像素 × 设备像素比"
          />
        </div>
      </Card>

      {/* 性能与容量 */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <SectionTitle title="性能" desc="浏览器能吃到的硬件档位" icon={<Cpu size={16} />} />
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Stat
              label="CPU 核心"
              value={
                info?.cpuCores ? <span className="num">{info.cpuCores}</span> : <Dash />
              }
              hint="navigator.hardwareConcurrency"
            />
            <Stat
              label="内存"
              value={
                info?.memoryGb ? (
                  <span className="num">≈ {info.memoryGb} GB</span>
                ) : (
                  <Dash />
                )
              }
              hint={info?.memoryGb ? '分档近似值，非精确容量' : '浏览器未提供 deviceMemory'}
            />
          </div>
          {!info?.memoryGb && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
              内存是 WebView 的可选能力，安卓上多数实现不暴露 deviceMemory。
            </p>
          )}
        </Card>

        <Card>
          <SectionTitle
            title="存储"
            desc="当前站点在本机的占用估算"
            icon={<HardDrive size={16} />}
          />
          {!storage || storagePercent === null ? (
            <p className="mt-4 text-[12px] text-faint">不可用：浏览器没有返回 storage.estimate()</p>
          ) : (
            <>
              <div className="mt-4 flex items-baseline justify-between gap-2">
                <span className="num text-2xl font-semibold text-fg">
                  {bytes(storage.usage)}
                </span>
                <span className="num text-[12px] text-muted">
                  / {bytes(storage.quota)} · {storagePercent.toFixed(0)}%
                </span>
              </div>
              <ProgressBar value={storagePercent} className="mt-2" />
              <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
                这是本站点可用配额，不等于手机总容量。
              </p>
            </>
          )}
        </Card>
      </div>

      {/* 网络与电池 */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <SectionTitle title="网络" desc="浏览器给的估值" icon={<Wifi size={16} />} />
          <div className="mt-4 grid grid-cols-3 gap-4">
            <Stat
              label="类型"
              value={
                net?.effectiveType ? (
                  <span className="text-[13px]">{netLabel(net.effectiveType)}</span>
                ) : (
                  <Dash />
                )
              }
            />
            <Stat
              label="下行"
              value={
                net?.downlink ? (
                  <span className="num text-[13px]">{net.downlink} Mbps</span>
                ) : (
                  <Dash />
                )
              }
            />
            <Stat
              label="RTT"
              value={
                net?.rtt ? <span className="num text-[13px]">{net.rtt} ms</span> : <Dash />
              }
            />
          </div>
          {net?.saveData && (
            <p className="mt-3 text-[11.5px] text-warn">系统已开启省流量模式</p>
          )}
          {!net && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
              navigator.connection 在安卓 WebView 里可能不存在，此时读不到网络档位。
            </p>
          )}
        </Card>

        <Card>
          <SectionTitle title="电池" desc="Battery Status API" icon={<BatteryMedium size={16} />} />
          {battery?.level === null || battery?.level === undefined ? (
            <p className="mt-4 text-[12px] leading-relaxed text-faint">
              不可用：安卓 WebView / iOS Safari 普遍不实现 getBattery()，拿不到电量。
            </p>
          ) : (
            <>
              <div className="mt-4 flex items-baseline justify-between gap-2">
                <span className="num text-2xl font-semibold text-fg">
                  {Math.round((battery.level ?? 0) * 100)}%
                </span>
                <Badge tone={battery.charging ? 'ok' : 'neutral'}>
                  {battery.charging ? '充电中' : '未充电'}
                </Badge>
              </div>
              <ProgressBar
                value={Math.max(0, Math.min(100, (battery.level ?? 0) * 100))}
                tone={battery.charging ? 'ok' : 'cyan'}
                className="mt-2"
              />
            </>
          )}
        </Card>
      </div>

      {/* 说明：为什么这一页和电脑上的「本机」长得不一样 */}
      <Card>
        <div className="flex items-start gap-3">
          <Info size={16} className="mt-0.5 shrink-0 text-accent-soft" />
          <div className="min-w-0 flex-1">
            <h3 className="text-[13.5px] font-semibold text-fg">手机不能当被控端</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              LanDeck 的被控端是桌面程序，只能在 Windows / macOS / Linux 上运行。
              手机这一端只做控制端：这里显示的信息全部由手机自己读取，
              不需要启动任何被控服务，也不消耗后台进程。
              要控制<strong className="text-fg-soft">别的</strong>电脑，请去「发现」页扫描它。
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
