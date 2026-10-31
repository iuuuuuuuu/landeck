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

/** 拿不到的字段统一话术：说清楚"不支持"，不要拿 0/空串/近似值凑数 */
const UNSUPPORTED = '此设备不支持读取'

/** 网络类型：Network Information API 给的是 4g/3g 这种代号（估算，不是实测制式） */
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

function Dash({ text = UNSUPPORTED }: { text?: string }) {
  return <span className="text-[12.5px] font-normal text-faint">{text}</span>
}

/** Stat 的值槽位默认是 24px 数字，字符串类参数用小字号 */
const SMALL = 'text-[13px]'

/**
 * 手机「本机」页：展示这台手机自己的信息。
 *
 * 手机上跑不了被控端（agent_start 是桌面端专属命令，移动端只会返回 Err），
 * 所以这一页不再请求 Agent，而是用 Web API 读设备自身。
 *
 * 每一格都按「来源 + 精度」标注：
 *   - 无前缀 = 系统/浏览器直接给出的值；
 *   - ≈ = 浏览器估算或分档值（内存档位、下行速率、RTT）；
 *   - 推算 = 由别的值算出来的（物理像素 = CSS×DPR，不是面板原生分辨率）；
 *   - 「此设备不支持读取」= 该 API 在本 WebView 里不存在，绝不填 0。
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
  const nativeCount = info?.nativeFields.length ?? 0
  const storagePercent =
    storage && storage.usage !== null && storage.quota && storage.quota > 0
      ? Math.min(100, (storage.usage / storage.quota) * 100)
      : null

  return (
    <div className="space-y-3">
      {/* 顶部身份条：手机自己，没有「实时/未连接」——这里根本没有连接对象 */}
      <Card className="flex flex-wrap items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] border border-line bg-gradient-to-br from-cyan/25 to-elevated text-cyan">
          <Smartphone size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[16px] font-semibold text-fg">{info?.model ?? '当前设备'}</h2>
            <Badge tone="cyan" dot>
              当前设备
            </Badge>
            <Badge tone="neutral">{info?.system ?? '未知系统'}</Badge>
            {nativeCount > 0 && <Badge tone="ok">{nativeCount} 项来自系统 API</Badge>}
          </div>
          <p className="mt-1 text-[12px] text-muted">
            这些数据由手机自身读取，不需要被控端；带 ≈ 的是估算值，不是硬件精确参数
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void load()} loading={loading}>
          <RefreshCw size={14} className="mr-1" />
          刷新
        </Button>
      </Card>

      {/* 型号与屏幕 */}
      <Card>
        <SectionTitle
          title="设备与屏幕"
          desc="型号来自 UA，屏幕读数来自浏览器环境"
          icon={<Smartphone size={16} />}
        />
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="型号"
            value={<span className={SMALL}>{info?.model ?? '—'}</span>}
            hint={
              info?.modelKnown
                ? info.os === 'android'
                  ? 'UA 中 Build/ 前的机型'
                  : 'iOS UA 只暴露设备类型'
                : 'UA 里是隐私占位符，已显示通用名'
            }
          />
          <Stat label="系统" value={<span className={SMALL}>{info?.system ?? '—'}</span>} />

          <Stat
            label="逻辑分辨率"
            value={
              screen ? (
                <span className="num text-[13px]">
                  {screen.cssWidth} × {screen.cssHeight}
                </span>
              ) : (
                <Dash />
              )
            }
            hint={screen ? `CSS px · 页面缩放后` : undefined}
          />
          <Stat
            label="物理像素"
            value={
              screen ? (
                <span className="num text-[13px]">
                  {screen.pixelWidth} × {screen.pixelHeight}
                </span>
              ) : (
                <Dash />
              )
            }
            hint={screen ? `推算：CSS×DPR(${screen.dpr})` : undefined}
          />
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
          浏览器只报告 CSS 逻辑像素（{screen ? `${screen.cssWidth}×${screen.cssHeight}` : '未知'}），
          「物理像素」由逻辑像素乘设备像素比 {screen ? screen.dpr : 'DPR'} 推算而来，
          {screen?.source === 'native' ? '已由系统 API 校正。' : '不等于屏幕面板的原生分辨率。'}
          {screen && !Number.isInteger(screen.dpr) && (
            <> 当前 DPR {screen.dpr} 不是整数，说明系统显示缩放改写过它，两个数字都对不上属正常。</>
          )}
        </p>
      </Card>

      {/* 性能与容量 */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <SectionTitle title="性能" desc="浏览器能吃到的档位，不是硬件规格表" icon={<Cpu size={16} />} />
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Stat
              label="CPU 核心"
              value={
                info?.cpuCores ? (
                  <span className="num">
                    {info.cpuCoresSource === 'native' ? '' : '≈ '}
                    {info.cpuCores}
                  </span>
                ) : (
                  <Dash />
                )
              }
              hint={info?.cpuCoresSource === 'native' ? '系统 API 读取' : '浏览器上报的逻辑核心'}
            />
            <Stat
              label="内存"
              value={
                info?.memoryGb ? (
                  <span className="num">
                    {info.memorySource === 'native' ? '' : '≈ '}
                    {info.memoryGb} GB
                  </span>
                ) : (
                  <Dash />
                )
              }
              hint={info?.memorySource === 'native' ? '系统 API 读取' : '浏览器分档估算'}
            />
          </div>
          {/* 文案必须跟着实际来源走：拿到系统真值还说"网页读不到"就是在误导用户 */}
          <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
            {info?.memorySource === 'native' ? (
              <>
                内存与 CPU 核心来自系统 API（ActivityManager / 内核），是这台设备真实的硬件规格，
                不是浏览器估算值。
              </>
            ) : info?.memoryGb ? (
              <>
                内存只有分档值（0.25 / 0.5 / 1 / 2 / 4 / 8 GB），实际可能是 {info.memoryGb} GB
                上下的任意容量。CPU 核心来自 navigator.hardwareConcurrency，安卓 WebView 常年固定
                返回 4，只能当参照。
              </>
            ) : (
              <>
                这台设备没能读到内存与核心数：安卓把 /proc/meminfo 限制为系统专属，浏览器侧也不实现
                navigator.deviceMemory。可以到「设置 → 关于手机」查看。
              </>
            )}
          </p>
        </Card>

        <Card>
          <SectionTitle
            title="存储"
            desc="当前站点在本机的配额，不是手机总容量"
            icon={<HardDrive size={16} />}
          />
          {!storage || (storage.usage === null && storage.quota === null) ? (
            <p className="mt-4 text-[12px] leading-relaxed text-faint">
              此设备不支持读取：浏览器没有返回 storage.estimate()。
            </p>
          ) : (
            <>
              <div className="mt-4 flex items-baseline justify-between gap-2">
                <span className="num text-2xl font-semibold text-fg">
                  {storage.usage === null ? '未知' : bytes(storage.usage)}
                </span>
                <span className="num text-[12px] text-muted">
                  / {storage.quota === null ? '配额未知' : bytes(storage.quota)}
                  {storagePercent !== null ? ` · ${storagePercent.toFixed(0)}%` : ''}
                </span>
              </div>
              {storagePercent !== null && (
                <ProgressBar value={storagePercent} className="mt-2" />
              )}
              <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
                这是本站点可用配额（
                {storage.source === 'native' ? '系统 API' : 'navigator.storage.estimate()'}
                ），不等于手机总容量；用了多少也含缓存与临时数据。
              </p>
            </>
          )}
        </Card>
      </div>

      {/* 网络与电池 */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <SectionTitle title="网络" desc="浏览器给的估值，不是链路实测" icon={<Wifi size={16} />} />
          {!net ? (
            <p className="mt-4 text-[12px] leading-relaxed text-faint">
              此设备不支持读取：navigator.connection 在安卓 WebView 里通常不存在，读不到网络档位。
            </p>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-3 gap-4">
                <Stat
                  label="类型"
                  value={
                    net.effectiveType ? (
                      <span className={SMALL}>{netLabel(net.effectiveType)}</span>
                    ) : (
                      <Dash text="未提供" />
                    )
                  }
                  hint="按带宽粗分，非实测制式"
                />
                <Stat
                  label="下行"
                  value={
                    net.downlink !== null ? (
                      <span className="num text-[13px]">≈ {net.downlink} Mbps</span>
                    ) : (
                      <Dash text="未提供" />
                    )
                  }
                  hint="档位估算"
                />
                <Stat
                  label="RTT"
                  value={
                    net.rtt !== null ? (
                      <span className="num text-[13px]">≈ {net.rtt} ms</span>
                    ) : (
                      <Dash text="未提供" />
                    )
                  }
                  hint="档位估算"
                />
              </div>
              <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
                来源：{net.source === 'native' ? '系统 API' : 'navigator.connection'}。
                下行与 RTT 是浏览器按档位给的估值（常见 25/50/100 Mbps），不是测速结果。
              </p>
              {net.saveData && <p className="mt-2 text-[11.5px] text-warn">系统已开启省流量模式</p>}
            </>
          )}
        </Card>

        <Card>
          <SectionTitle title="电池" desc="Battery Status API" icon={<BatteryMedium size={16} />} />
          {battery?.level === null || battery?.level === undefined ? (
            <p className="mt-4 text-[12px] leading-relaxed text-faint">
              此设备不支持读取：安卓 WebView / iOS Safari 普遍不实现 navigator.getBattery()，网页拿不到电量。
              {battery?.charging !== null && battery?.charging !== undefined && (
                <> 只读到「{battery.charging ? '充电中' : '未充电'}」状态，没有电量百分比。</>
              )}
            </p>
          ) : (
            <>
              <div className="mt-4 flex items-baseline justify-between gap-2">
                <span className="num text-2xl font-semibold text-fg">
                  {Math.round(battery.level * 100)}%
                </span>
                {battery.charging !== null && (
                  <Badge tone={battery.charging ? 'ok' : 'neutral'}>
                    {battery.charging ? '充电中' : '未充电'}
                  </Badge>
                )}
              </div>
              <ProgressBar
                value={Math.max(0, Math.min(100, battery.level * 100))}
                tone={battery.charging ? 'ok' : 'cyan'}
                className="mt-2"
              />
              <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
                来源：{battery.source === 'native' ? '系统 API' : 'Battery Status API'}，
                百分比按 0–1 浮点四舍五入。
              </p>
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
