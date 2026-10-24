import {
  Copy,
  Info,
  KeyRound,
  Monitor,
  Moon,
  Palette,
  Radar,
  Save,
  ShieldAlert,
  Sun,
  UserRound,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AgentSettingsCard } from '../components/pair/AgentSettingsCard'
import { apiErrorMessage } from '../components/pair/errors'
import { PairingSecurityCard } from '../components/pair/PairingSecurityCard'
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  SectionTitle,
  Segmented,
  Skeleton,
  Toggle,
} from '../components/ui'
import { AgentClient, ApiError, baseUrl } from '../lib/api'
import { duration, osLabel } from '../lib/format'
import { autostartGet, autostartSet } from '../lib/discovery'
import { useAsync } from '../lib/hooks'
import { useApp, type PairedDevice } from '../store/app'
import { THEME_LABEL, useTheme, type ThemeMode } from '../store/theme'

/** 进入设置页前的会话检查：未配对 / 401 / 离线在这里统一拦成整页提示 */
function useSessionGate(device?: PairedDevice) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; auth: boolean }>({
    loading: !!device,
    error: null,
    auth: false,
  })
  const [nonce, setNonce] = useState(0)
  const devRef = useRef(device)
  devRef.current = device

  useEffect(() => {
    const d = devRef.current
    if (!d) {
      setState({ loading: false, error: null, auth: false })
      return
    }
    let cancelled = false
    setState({ loading: true, error: null, auth: false })
    AgentClient.fromDevice(d)
      .session()
      .then(() => {
        if (!cancelled) setState({ loading: false, error: null, auth: false })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const status = e instanceof ApiError ? e.status : 0
        setState({
          loading: false,
          auth: status === 401 || status === 403,
          error: apiErrorMessage(e, '读取设备会话失败'),
        })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.id, device?.token, device?.host, device?.port, nonce])

  return { ...state, retry: () => setNonce((n) => n + 1) }
}

/** 第 1 组：本机身份 */
function IdentityCard() {
  const myName = useApp((s) => s.myName)
  const myId = useApp((s) => s.myId)
  const setMyName = useApp((s) => s.setMyName)
  const toast = useApp((s) => s.toast)
  const [name, setName] = useState(myName)
  const dirty = name.trim() !== myName && name.trim().length > 0

  return (
    <Card>
      <SectionTitle
        icon={<UserRound size={16} />}
        title="本机身份"
        desc="这个名称在配对时显示在被控机上，方便区分是哪台控制端。"
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Field label="客户端名称" hint={`本机标识：${myId}（保存在此浏览器）`}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            placeholder="例如 YG 的笔记本"
          />
        </Field>
        <Button
          variant="primary"
          icon={<Save size={15} />}
          disabled={!dirty}
          onClick={() => {
            setMyName(name.trim())
            toast({ kind: 'ok', title: '客户端名称已更新', desc: name.trim() })
          }}
        >
          保存
        </Button>
      </div>
    </Card>
  )
}

const PORTS = [
  { port: '8420', proto: 'TCP', desc: 'HTTP API + WebSocket + 内嵌 Web UI' },
  { port: '8421', proto: 'UDP', desc: '局域网发现广播（mDNS 的兜底通道）' },
  { port: '8443', proto: 'TCP', desc: '可选 TLS 监听，自签证书' },
]

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="shrink-0 text-[12px] text-muted">{label}</span>
      <span className="min-w-0 truncate text-right text-[12.5px] text-fg-soft">{value}</span>
    </div>
  )
}

/** 第 4 组：关于 */
function AboutCard({ device }: { device: PairedDevice }) {
  const toast = useApp((s) => s.toast)
  const client = AgentClient.fromDevice(device)
  const { data, loading, error } = useAsync(() => client.system(), [device.id, device.token])
  const base = baseUrl(device)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(base)
      toast({ kind: 'ok', title: '已复制 API 地址', desc: base })
    } catch {
      toast({
        kind: 'error',
        title: '复制失败',
        desc: '浏览器拒绝了剪贴板访问，请手动选中地址复制',
      })
    }
  }

  return (
    <Card>
      <SectionTitle
        icon={<Info size={16} />}
        title="关于"
        desc="Agent 版本、API 契约入口与端口约定。"
      />

      {loading && !data ? (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : error && !data ? (
        <p className="mt-4 text-[12px] text-danger">{apiErrorMessage(error, '读取 Agent 信息失败')}</p>
      ) : data ? (
        <>
          <div className="mt-3 divide-y divide-line-soft">
            <Row label="Agent 版本" value={<span className="num">{data.agentVersion}</span>} />
            <Row label="设备" value={`${data.hostname} · ${osLabel(data.platform)}`} />
            <Row label="系统" value={data.os} />
            <Row
              label="运行时长"
              value={<span className="num">{duration(data.uptimeSec, 'short')}</span>}
            />
          </div>

          <div className="mt-3 rounded-xl border border-line-soft bg-elevated p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11.5px] text-muted">API 契约入口</span>
              <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => void copy()}>
                复制地址
              </Button>
            </div>
            <div className="num mt-1.5 break-all text-[12px] text-accent-soft">{base}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {['GET /hello', 'POST /pair', 'GET /system', 'GET /status', 'WS /ws'].map((p) => (
                <span
                  key={p}
                  className="num rounded-md border border-line-soft bg-elevated px-1.5 py-0.5 text-[10.5px] text-muted"
                >
                  {p}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              字段含义以仓库内的 docs/API.md 为唯一事实来源；本文档随 Agent 版本 v1 冻结。
            </p>
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-line-soft">
            <div className="grid grid-cols-[64px_52px_minmax(0,1fr)] gap-2 border-b border-line-soft bg-elevated px-3 py-2 text-[10.5px] uppercase tracking-[0.08em] text-faint">
              <span>端口</span>
              <span>协议</span>
              <span>用途</span>
            </div>
            {PORTS.map((p) => (
              <div
                key={p.port}
                className="grid grid-cols-[64px_52px_minmax(0,1fr)] items-center gap-2 px-3 py-2 text-[11.5px]"
              >
                <span className="num text-fg-soft">{p.port}</span>
                <span className="text-muted">{p.proto}</span>
                <span className="truncate text-muted">{p.desc}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </Card>
  )
}

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: ReactNode }[] = [
  { value: 'system', label: '跟随系统', icon: <Monitor size={14} /> },
  { value: 'dark', label: '深色', icon: <Moon size={14} /> },
  { value: 'light', label: '浅色', icon: <Sun size={14} /> },
]

/** 第 0 组：外观 + 桌面端自启。不依赖设备，未配对 / 离线时也照样能用 */
function AppearanceCard() {
  const { mode, theme, setMode } = useTheme()
  const toast = useApp((s) => s.toast)
  const [auto, setAuto] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void autostartGet().then((v) => {
      if (alive) setAuto(v)
    })
    return () => {
      alive = false
    }
  }, [])

  const toggleAuto = async (next: boolean) => {
    setBusy(true)
    const res = await autostartSet(next)
    setBusy(false)
    if (!res.ok) {
      // 系统策略/安全软件拦截时把真实原因给用户，不静默失败
      toast({ kind: 'error', title: '设置开机自启失败', desc: res.error })
      return
    }
    setAuto(next)
    toast({ kind: 'ok', title: next ? '已开启开机自启' : '已关闭开机自启' })
  }

  return (
    <Card>
      <SectionTitle
        icon={<Palette size={16} />}
        title="外观与启动"
        desc="「跟随系统」会随操作系统的深浅色设置实时变化；选择记在这个浏览器里，刷新不丢。"
      />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented value={mode} onChange={setMode} options={THEME_OPTIONS} />
        <span className="text-[12px] text-muted">
          选择：<span className="text-fg-soft">{THEME_LABEL[mode]}</span>
          <span className="text-faint"> · 当前生效 {theme === 'light' ? '浅色' : '深色'}</span>
        </span>
      </div>

      <div className="mt-4 border-t border-line-soft pt-4">
        {auto === null ? (
          <p className="text-[12px] text-faint">
            开机自启只能在桌面端 App 里设置；浏览器打开的页面没有这个能力。
          </p>
        ) : (
          <Toggle
            checked={auto}
            disabled={busy}
            onChange={(v) => void toggleAuto(v)}
            label="开机自启"
            desc="登录系统后自动运行 LanDeck，这样随时都能从手机连上这台电脑。"
          />
        )}
      </div>
    </Card>
  )
}

/** 设置页：外观 / 身份 / 被控端 / 配对安全 / 关于 */
export default function Settings() {
  const devices = useApp((s) => s.devices)
  const activeId = useApp((s) => s.activeId)
  const device = devices.find((d) => d.id === activeId) ?? devices[0]
  const gate = useSessionGate(device)
  const navigate = useNavigate()

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-3">
      <AppearanceCard />

      {!device ? (
        <Card>
          <EmptyState
            icon={<KeyRound size={26} />}
            title="先配对一台设备"
            desc="设置项都作用在某台被控机的 Agent 上。先扫描局域网，用随机码或固定密钥完成配对。"
            action={
              <Button variant="primary" icon={<Radar size={16} />} onClick={() => navigate('/scan')}>
                扫描局域网
              </Button>
            }
          />
        </Card>
      ) : gate.loading ? (
        <>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-72 w-full" />
        </>
      ) : gate.error ? (
        <Card>
          <EmptyState
            icon={<ShieldAlert size={26} />}
            title={gate.auth ? '先配对一台设备' : '设备当前不可达'}
            desc={
              gate.auth
                ? '令牌已失效或没有访问权限，重新配对后就能修改设置。'
                : `${device.name}：${gate.error}。确认它已开机、Agent 在运行，并和本机在同一局域网。`
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={gate.retry}>重试</Button>
                <Button variant="primary" onClick={() => navigate('/scan')}>
                  {gate.auth ? '重新配对' : '扫描局域网'}
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <IdentityCard />
          <AgentSettingsCard device={device} />
          <PairingSecurityCard device={device} />
          <AboutCard device={device} />
        </>
      )}
    </div>
  )
}
