import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button, Card } from '../../components/ui'
import { RdViewer, cmpVer } from '../../components/rd/RdViewer'
import { useApp } from '../../store/app'

/**
 * 远程桌面查看器页 /rd/:deviceId。
 *
 * 全屏接管布局：本页渲染在 App 的短路口上（AppShell 之外），**不在任何 <Route>
 * 匹配上下文里**，useParams 拿不到东西——deviceId 从 location.pathname 解析。
 * agent 版本 < 1.0.19（无 RD 路由）→ demo 模式：横幅说明 + 内置测试图案，
 * 与 activityApi 的「演示数据」降级同一策略。
 */
export default function RdViewerPage() {
  const deviceId = useLocation().pathname.split('/')[2] ?? ''
  const navigate = useNavigate()
  const devices = useApp((s) => s.devices)
  const device = useMemo(
    () => devices.find((d) => d.id === deviceId) ?? null,
    [devices, deviceId],
  )

  const demo = useMemo(() => {
    if (!device) return true
    // 1.0.19 起才有 /rd/stream；ver 缺失当作太旧（宁降级不白屏）
    return cmpVer(device.ver, '1.0.19') < 0
  }, [device])

  if (!device) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black p-6">
        <Card className="max-w-sm p-5 text-center">
          <p className="text-[14px] text-fg">设备不存在或已被移除</p>
          <Button variant="secondary" className="mt-3" onClick={() => navigate('/devices')}>
            返回设备列表
          </Button>
        </Card>
      </div>
    )
  }

  const target = {
    host: device.host,
    port: device.port,
    tls: device.tls,
    ...(device.local ? { local: true } : {}),
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black">
      {/* 顶缘：返回 + 标题 + demo 横幅 */}
      <div className="relative z-20 flex shrink-0 items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="返回"
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/15 px-3 text-[12.5px] text-white/80 hover:bg-white/10"
        >
          <ArrowLeft size={15} />
          返回
        </button>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium text-white/90">
            远程桌面 · {device.name}
          </div>
          <div className="num truncate text-[11px] text-white/50">
            {device.host}:{device.port}
          </div>
        </div>
        {demo && (
          <div className="ml-auto rounded-xl border border-warn/40 bg-warn/10 px-3 py-1.5 text-[11.5px] leading-snug text-warn">
            需要 Agent 1.0.19+（当前 {device.ver || '未知'}）——正在显示内置演示画面
          </div>
        )}
      </div>

      {/* 画布区：等比缩放 + 黑边留白，flex-1 撑满余下视口 */}
      <div className="min-h-0 flex-1">
        <RdViewer
          deviceName={device.name}
          target={target}
          token={device.token}
          demo={demo}
          onDisconnect={() => navigate(`/devices/${device.id}`)}
        />
      </div>
    </div>
  )
}
