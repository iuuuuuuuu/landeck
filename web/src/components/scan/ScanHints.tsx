import { Compass, Server, ShieldCheck, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card, SectionTitle } from '../ui'

const TIPS: { icon: ReactNode; title: string; desc: string }[] = [
  {
    icon: <WifiOff size={15} />,
    title: '同一个局域网',
    desc: '控制端与被控机要在同一网段；访客网络、跨 VLAN、开了 AP 隔离都扫不到。',
  },
  {
    icon: <Server size={15} />,
    title: 'Agent 正在运行',
    desc: '在被控机上启动 landeck-agent，托盘出现图标即已开始监听 8420。',
  },
  {
    icon: <ShieldCheck size={15} />,
    title: '防火墙放行',
    desc: '放行 TCP 8420（HTTP/接口）与 UDP 8421（广播发现）；Windows 首次运行选「专用网络」。',
  },
  {
    icon: <Compass size={15} />,
    title: '手动填 IP',
    desc: '知道地址就直接在右侧「手动添加」里填 192.168.1.20:8420。',
  },
]

/** 扫不到设备时可操作的排查清单 */
export function ScanHints({ noHint }: { noHint?: boolean }) {
  return (
    <Card>
      <SectionTitle
        icon={<Compass size={16} />}
        title="扫不到设备？"
        desc="按顺序排查，通常 30 秒内能定位。"
      />
      <ul className="mt-3.5 space-y-3">
        {TIPS.map((t) => (
          <li key={t.title} className="flex gap-2.5">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-line bg-elevated text-accent-soft">
              {t.icon}
            </span>
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium text-fg">{t.title}</div>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{t.desc}</p>
            </div>
          </li>
        ))}
      </ul>
      {noHint && (
        <p className="mt-3 rounded-xl border border-warn/25 bg-warn/[0.07] px-3 py-2 text-[11.5px] leading-relaxed text-warn">
          当前页面地址不是局域网 IP（可能是 localhost 或公网域名），无法自动推导网段。请改用
          http://被控机IP:8420 打开本页，或直接用上面的「手动添加」填 IP。
        </p>
      )}
    </Card>
  )
}
