import {
  Copy,
  Info,
  KeyRound,
  Languages,
  Minus,
  Monitor,
  Moon,
  Palette,
  Radar,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  UserRound,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AgentSettingsCard } from '../components/pair/AgentSettingsCard'
import { CloudSyncCard } from '../components/settings/CloudSyncCard'
import { isPhoneOS } from '../lib/runtime'
import { readNativeDeviceProfile } from '../lib/deviceSelf'
import { apiErrorMessage } from '../components/pair/errors'
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
import {
  autostartGet,
  autostartSet,
  silentAutostartGet,
  silentAutostartSet,
  lightweightGet,
  lightweightSet,
} from '../lib/discovery'
import { useRuntime } from '../lib/runtime'
import { useAsync } from '../lib/hooks'
import { systemKey } from '../lib/keys'
import {
  getAppVersion,
  checkForUpdate,
  installUpdate,
  listenUpdateAvailable,
  updateAutoGet,
  updateAutoSet,
  type UpdateInfo,
} from '../lib/updaterApi'
import { useApp, type PairedDevice } from '../store/app'
import { useT } from '../i18n'
import { THEME_LABEL, THEME_NAME_LABEL, useTheme, type ThemeMode } from '../store/theme'
import { LANG_LABEL, LANGS, currentLang, setLang, type Lang } from '../i18n'
import { PageHeader } from '../components/shell'

/** 进入设置页前的会话检查：未配对 / 401 / 离线在这里统一拦成整页提示 */
function useSessionGate(device?: PairedDevice) {
  const t = useT('settings')
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
          error: apiErrorMessage(e, t('about.sessionError')),
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
  const t = useT('settings')
  const myName = useApp((s) => s.myName)
  const myId = useApp((s) => s.myId)
  const setMyName = useApp((s) => s.setMyName)
  const toast = useApp((s) => s.toast)
  const [name, setName] = useState(myName)
  const dirty = name.trim() !== myName && name.trim().length > 0

  // 从没用过自定义名字时，用原生读到的机型名打底（比「Android 手机」有辨识度多了）。
  // 只在用户没动过输入框时覆盖，避免打断正在输入的内容。
  const [autoFilled, setAutoFilled] = useState(false)
  useEffect(() => {
    if (autoFilled || name.trim() !== myName) return
    let alive = true
    void readNativeDeviceProfile().then((p) => {
      const model = (p?.model || '').trim()
      if (!alive || !model) return
      // 只在当前名字还是默认值时才替换
      if (/^(Android 手机|iPhone|Mac|Windows PC|Linux 设备|我的设备)$/.test(myName.trim())) {
        setName(model)
        setAutoFilled(true)
      }
    })
    return () => {
      alive = false
    }
  }, [autoFilled, name, myName])

  return (
    <Card>
      <SectionTitle
        icon={<UserRound size={16} />}
        title={t("identity.title")}
        desc={t("identity.desc")}
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Field label={t("identity.nameLabel")} hint={t("identity.nameHintPrefix") + myId + t("identity.nameHintSuffix")}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            placeholder={t("identity.namePlaceholder")}
          />
        </Field>
        <Button
          variant="primary"
          icon={<Save size={15} />}
          disabled={!dirty}
          onClick={() => {
            setMyName(name.trim())
            toast({ kind: 'ok', title: t('identity.saved'), desc: name.trim() })
          }}
        >
          {t("save")}
        </Button>
      </div>
    </Card>
  )
}

const PORTS = [
  { port: '8420', proto: 'TCP', desc: 'about.portHttp' },
  { port: '8421', proto: 'UDP', desc: 'about.portDiscovery' },
  { port: '8443', proto: 'TCP', desc: 'about.portTls' },
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
  const t = useT('settings')
  const toast = useApp((s) => s.toast)
  const client = AgentClient.fromDevice(device)
  const { data, loading, error } = useAsync(() => client.system(), [device.id, device.token], {
    // 与设备详情/文件页共用同一条系统信息缓存
    key: systemKey(client),
    ttlMs: 5 * 60_000,
  })
  const base = baseUrl(device)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(base)
      toast({ kind: 'ok', title: t('about.copyOk'), desc: base })
    } catch {
      toast({
        kind: 'error',
        title: t('about.copyFailed'),
        desc: t('about.clipboardDenied'),
      })
    }
  }

  // ---------- A7 自动检查更新（仅桌面壳；浏览器/Android 无 updater 概念） ----------
  const runtime = useRuntime()
  const isDesktopShell = runtime === 'desktop'
  const [appVer, setAppVer] = useState<string | null>(null)
  const [auto, setAuto] = useState<boolean | null>(null)
  const [busyAuto, setBusyAuto] = useState(false)
  const [checking, setChecking] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [upToDate, setUpToDate] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (!isDesktopShell) return
    let alive = true
    void getAppVersion().then((v) => {
      if (alive) setAppVer(v)
    })
    void updateAutoGet().then((v) => {
      if (alive) setAuto(v)
    })
    // Rust 启动静默检查（可在下方开关关闭）的结果事件：有更新就展示，绝不自动安装。
    // listenUpdateAvailable 是 async：清理函数等它 resolve 后再真正解绑，
    // 组件先卸载的话由 alive2 标志把迟到的事件丢弃。
    let un: (() => void) | undefined
    let alive2 = true
    void listenUpdateAvailable((info) => {
      if (alive2) {
        setUpdateInfo(info)
        setUpToDate(false)
        setCheckError(null)
      }
    }).then((u) => {
      if (alive2) un = u
      else u()
    })
    return () => {
      alive2 = false
      un?.()
    }
  }, [isDesktopShell])

  const toggleAuto = async (next: boolean) => {
    setBusyAuto(true)
    const res = await updateAutoSet(next)
    setBusyAuto(false)
    if (!res.ok) {
      toast({ kind: 'error', title: t('update.autoSetFailed'), desc: res.error })
      return
    }
    setAuto(next)
    toast({
      kind: 'ok',
      title: next ? t('update.autoOn') : t('update.autoOff'),
      desc: next ? t('update.autoOnDesc') : t('update.autoOffDesc'),
    })
  }

  const checkNow = async () => {
    setChecking(true)
    setCheckError(null)
    setUpToDate(false)
    try {
      const info = await checkForUpdate()
      if (info) {
        setUpdateInfo(info)
        toast({ kind: 'ok', title: `${t('update.found')} ${info.version}`, desc: t('update.foundToast') })
      } else {
        setUpdateInfo(null)
        setUpToDate(true)
      }
    } catch (e) {
      setCheckError((e as Error).message || t('update.checkFailed'))
    } finally {
      setChecking(false)
    }
  }

  const doUpdate = async () => {
    if (!updateInfo) return
    setInstalling(true)
    // downloadAndInstall（passive 进度条）完成后 relaunch，页面这里不用再收尾
    try {
      await installUpdate()
    } catch (e) {
      setInstalling(false)
      toast({ kind: 'error', title: t('update.updateFailed'), desc: (e as Error).message })
    }
  }

  return (
    <Card>
      <SectionTitle
        icon={<Info size={16} />}
        title={t("about.title")}
        desc={t("about.desc")}
      />

      {loading && !data ? (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : error && !data ? (
        <p className="mt-4 text-[12px] text-danger">{apiErrorMessage(error, t('about.agentInfoError'))}</p>
      ) : data ? (
        <>
          <div className="mt-3 divide-y divide-line-soft">
            <Row label={t("about.agentVersion")} value={<span className="num">{data.agentVersion}</span>} />
            <Row label={t("about.device")} value={`${data.hostname} · ${osLabel(data.platform)}`} />
            <Row label={t("about.os")} value={data.os} />
            <Row
              label={t("about.uptime")}
              value={<span className="num">{duration(data.uptimeSec, 'short')}</span>}
            />
          </div>

          <div className="mt-3 rounded-xl border border-line-soft bg-elevated p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11.5px] text-muted">{t("about.apiEntry")}</span>
              <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => void copy()}>
                {t("about.copyAddress")}
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
              {t("about.fieldNote")}
            </p>
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-line-soft">
            <div className="grid grid-cols-[64px_52px_minmax(0,1fr)] gap-2 border-b border-line-soft bg-elevated px-3 py-2 text-[10.5px] uppercase tracking-[0.08em] text-faint">
              <span>{t("about.portCol")}</span>
              <span>{t("about.protoCol")}</span>
              <span>{t("about.usageCol")}</span>
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

      {/* A7 自动检查更新：仅桌面壳显示（浏览器/Android 无 updater 概念） */}
      {isDesktopShell && (
        <div className="mt-3 rounded-xl border border-line-soft bg-elevated p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11.5px] text-muted">{t("update.clientVersion")}</span>
            <span className="num text-[12px] text-fg-soft">{appVer ?? '—'}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11.5px] text-muted">{t("update.autoCheck")}</span>
            {auto !== null ? (
              <Toggle checked={auto} disabled={busyAuto} onChange={(v) => void toggleAuto(v)} />
            ) : (
              <span className="text-[11px] text-faint">…</span>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11.5px] text-muted">{t("update.manual")}</span>
            <Button size="sm" variant="ghost" disabled={checking || installing} onClick={() => void checkNow()}>
              {checking ? t('update.checking') : t('update.checkNow')}
            </Button>
          </div>
          {installing && (
            <p className="mt-2 text-[11.5px] text-muted">
              {t("update.downloading")}
            </p>
          )}
          {updateInfo && !installing && (
            <div className="mt-2 rounded-lg border border-ok/30 bg-ok/[0.08] px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-fg-soft">
                  {t("update.found")} <span className="num font-semibold">{updateInfo.version}</span>
                </span>
                <Button size="sm" variant="primary" icon={<Sparkles size={13} />} onClick={() => void doUpdate()}>
                  {t("update.updateAndRestart")}
                </Button>
              </div>
              {updateInfo.notes && (
                <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted">{updateInfo.notes}</p>
              )}
            </div>
          )}
          {upToDate && !updateInfo && (
            <p className="mt-2 text-[11.5px] text-muted">{t("update.upToDate")}</p>
          )}
          {checkError && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-[11.5px] text-danger">{t("update.checkFailed")}{checkError}</p>
              <Button size="sm" variant="ghost" onClick={() => void checkNow()}>
                {t("retry")}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

const THEME_OPTIONS: { value: ThemeMode; labelKey: string; icon: ReactNode }[] = [
  { value: 'system', labelKey: 'themeSystem', icon: <Monitor size={14} /> },
  { value: 'light', labelKey: 'themeLight', icon: <Sun size={14} /> },
  { value: 'dark', labelKey: 'themeDark', icon: <Moon size={14} /> },
  { value: 'minimal', labelKey: 'themeMinimal', icon: <Minus size={14} /> },
  { value: 'flat', labelKey: 'themeFlat', icon: <Square size={14} /> },
]

/** 第 0 组：外观 + 桌面端自启。不依赖设备，未配对 / 离线时也照样能用 */

/** 界面语言卡：跟随系统 + 六语言，切换立即生效（i18next reactive，无需刷新）。 */
function LanguageCard() {
  const t = useT('settings')
  const [current, setCurrent] = useState<Lang>(() => currentLang())
  const [busy, setBusy] = useState(false)

  const pick = async (lang: Lang) => {
    if (lang === current || busy) return
    setBusy(true)
    try {
      await setLang(lang)
      setCurrent(lang)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-2 text-[15px] font-medium">
        <Languages size={16} />
        {t("lang.title")}
      </div>
      <p className="mt-1 text-[12px] text-fg-muted">{t("lang.desc")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {LANGS.map((lang) => (
          <button
            key={lang}
            onClick={() => void pick(lang)}
            disabled={busy}
            className={
              'rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ' +
              (lang === current
                ? 'border-transparent bg-accent text-white'
                : 'border-line-soft text-fg hover:border-accent/40')
            }
          >
            {LANG_LABEL[lang]}
          </button>
        ))}
      </div>
    </Card>
  )
}

function AppearanceCard() {
  const t = useT('settings')
  const { mode, theme, setMode } = useTheme()
  const toast = useApp((s) => s.toast)
  const runtime = useRuntime()
  // 只有桌面端 App 才谈得上「本机自启」：手机 App 没有这个概念，
  // 浏览器页面也没有原生能力。之前无差别显示，手机上出现了不该有的开关。
  const desktop = runtime === 'desktop'
  const [auto, setAuto] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  // 开机自启时是否静默启动（不弹窗，直接进托盘）
  const [silent, setSilent] = useState<boolean | null>(null)
  const [busySilent, setBusySilent] = useState(false)
  // 轻量模式：关窗时销毁界面以释放内存（与自启无关，随时可开关）
  const [light, setLight] = useState<boolean | null>(null)
  const [busyLight, setBusyLight] = useState(false)

  useEffect(() => {
    if (!desktop) return
    let alive = true
    void autostartGet().then((v) => {
      if (alive) setAuto(v)
    })
    void silentAutostartGet().then((v) => {
      if (alive) setSilent(v)
    })
    void lightweightGet().then((v) => {
      if (alive) setLight(v)
    })
    return () => {
      alive = false
    }
  }, [desktop])

  const toggleAuto = async (next: boolean) => {
    setBusy(true)
    const res = await autostartSet(next)
    setBusy(false)
    if (!res.ok) {
      // 系统策略/安全软件拦截时把真实原因给用户，不静默失败
      toast({ kind: 'error', title: t('startupToast.autostartFailed'), desc: res.error })
      return
    }
    setAuto(next)
    toast({ kind: 'ok', title: next ? t('startupToast.autostartOn') : t('startupToast.autostartOff') })
  }

  const toggleSilent = async (next: boolean) => {
    setBusySilent(true)
    const res = await silentAutostartSet(next)
    setBusySilent(false)
    if (!res.ok) {
      toast({ kind: 'error', title: t('appearance.silent.failed'), desc: res.error })
      return
    }
    setSilent(next)
    toast({
      kind: 'ok',
      title: next ? t('appearance.silent.on') : t('appearance.silent.off'),
      // 说清「下次开机」才生效，以及手动启动仍会显示窗口 —— 否则用户
      // 现在双击图标发现还是弹窗，会以为开关没生效
      desc: next
        ? t('appearance.silent.onDesc')
        : t('appearance.silent.offDesc'),
    })
  }

  const toggleLight = async (next: boolean) => {
    setBusyLight(true)
    const res = await lightweightSet(next)
    setBusyLight(false)
    if (!res.ok) {
      toast({ kind: 'error', title: t('appearance.lightweight.failed'), desc: res.error })
      return
    }
    setLight(next)
    toast({
      kind: 'ok',
      title: next ? t('appearance.lightweight.on') : t('appearance.lightweight.off'),
      // 必须说清代价：关窗后界面会被销毁，再打开是重建。
      // 数据有落盘缓存所以还是会立刻显示，但页面内的临时状态会丢。
      desc: next
        ? t('appearance.lightweight.onDesc')
        : t('appearance.lightweight.offDesc'),
    })
  }

  return (
    <Card>
      <SectionTitle
        icon={<Palette size={16} />}
        title={t("appearance.title")}
        desc={t("appearance.desc")}
      />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented value={mode} onChange={setMode} options={THEME_OPTIONS.map((o) => ({ ...o, label: t(o.labelKey) }))} />
        <span className="text-[12px] text-muted">
          {t("appearance.choose")}<span className="text-fg-soft">{THEME_LABEL[mode]}</span>
          <span className="text-faint"> · 当前生效 {THEME_NAME_LABEL[theme]}</span>
        </span>
      </div>

      {/* 仅桌面端：手机 App / 浏览器里根本不显示这一块 */}
      {desktop && auto !== null && (
        <div className="mt-4 border-t border-line-soft pt-4">
          <Toggle
            checked={auto}
            disabled={busy}
            onChange={(v) => void toggleAuto(v)}
            label={t("appearance.auto")}
            desc={t("appearance.autoDesc")}
          />
          {/* 只在自启开启时才有意义：没开自启时「开机静默」无从谈起 */}
          {auto && silent !== null && (
            <div className="mt-3 border-t border-line-soft pt-3">
              <Toggle
                checked={silent}
                disabled={busySilent}
                onChange={(v) => void toggleSilent(v)}
                label={t("appearance.silent.label")}
                desc={t("appearance.silent.desc")}
              />
            </div>
          )}
        </div>
      )}

      {/* 轻量模式与自启无关：只要在桌面端就显示 */}
      {desktop && light !== null && (
        <div className="mt-4 border-t border-line-soft pt-4">
          <Toggle
            checked={light}
            disabled={busyLight}
            onChange={(v) => void toggleLight(v)}
            label={t("appearance.lightweight.label")}
            desc={t("appearance.lightweight.desc")}
          />
        </div>
      )}
    </Card>
  )
}

/** 设置页：外观 / 身份 / 被控端 / 配对安全 / 关于 */
export default function Settings() {
  const t = useT('settings')
  const devices = useApp((s) => s.devices)
  const activeId = useApp((s) => s.activeId)
  const device = devices.find((d) => d.id === activeId) ?? devices[0]
  const gate = useSessionGate(device)
  const navigate = useNavigate()

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-3">
      <PageHeader title={t('title')} sub={t('subtitle')} />
      <AppearanceCard />

      <LanguageCard />

      {!device ? (
        <Card>
          <EmptyState
            icon={<KeyRound size={26} />}
            title={t("gate.pairTitle")}
            desc={t("gate.pairDesc")}
            action={
              <Button variant="primary" icon={<Radar size={16} />} onClick={() => navigate('/scan')}>
                {t("gate.pairAction")}
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
            title={gate.auth ? t('gate.authTitle') : t('gate.unreachableTitle')}
            desc={
              gate.auth
                ? t('gate.authDesc')
                : t('gate.unreachable', { name: device.name, err: gate.error })
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={gate.retry}>{t("retry")}</Button>
                <Button variant="primary" onClick={() => navigate('/scan')}>
                  {gate.auth ? t('gate.rescan') : t('gate.pairAction')}
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <IdentityCard />
          {isPhoneOS() ? (
            <Card>
              <SectionTitle
                icon={<SlidersHorizontal size={16} />}
                title={t("agentCard.title")}
                desc={t("agentCard.desc")}
              />
              <p className="mt-3 text-[12px] leading-relaxed text-muted">
                {t("agentCard.line1", { name: device.name })}
                {t("agentCard.line2")}
              </p>
            </Card>
          ) : (
            <>
              <AgentSettingsCard device={device} />
              {/* 十期 A1 云同步卡（WebDAV） */}
              <CloudSyncCard device={device} />
            </>
          )}
          <AboutCard device={device} />
        </>
      )}
    </div>
  )
}
