import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Maximize, Minimize, MonitorOff, Keyboard, Type, Minus, Plus, Unplug } from 'lucide-react'
import clsx from 'clsx'
import { RdClient, type RdState } from '../../lib/rdClient'
import { domKeyToVk } from '../../lib/rdKeys'

/**
 * 远程桌面查看器（B 节 RD-1 viewer 端）。
 *
 * 职责：JPEG 帧渲染（等比缩放黑边留白）、PC 鼠标/键盘输入、手机触摸映射
 * （tap=左键 / 长按 500ms=右键 / 双指滑动=滚动 / 捏合=本地缩放）、悬浮工具条、
 * 连接状态覆盖层。协议细节见 lib/rdClient.ts 头注释。
 *
 * demo 模式（agent 无 RD 路由）：不建 WS，canvas 画内置测试图案，
 * 页面层负责「需要 Agent 1.0.19+」横幅。
 */

/** 版本比较：'1.0.18' vs '1.0.19'；解析不了返回 -1（当作太旧）。 */
export function cmpVer(a: string | undefined, b: string): number {
  if (!a) return -1
  const pa = a.split('.').map((n) => parseInt(n, 10))
  const pb = b.split('.').map((n) => parseInt(n, 10))
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return -1
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** demo 模式的测试图案帧（内部画，不走 JPEG 链路）。 */
function drawDemoFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  name: string,
  tick: number,
): void {
  ctx.fillStyle = '#0b0e1a'
  ctx.fillRect(0, 0, w, h)
  // 网格
  ctx.strokeStyle = 'rgba(140,150,190,0.16)'
  ctx.lineWidth = 1
  for (let x = 0; x <= w; x += 80) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
  }
  for (let y = 0; y <= h; y += 80) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
  }
  // 移动的色块（证明画面在动、链路活着）
  const x = ((tick * 7) % (w + 160)) - 80
  const grad = ctx.createLinearGradient(x - 80, 0, x + 80, 0)
  grad.addColorStop(0, 'rgba(167,139,250,0)')
  grad.addColorStop(0.5, 'rgba(167,139,250,0.55)')
  grad.addColorStop(1, 'rgba(167,139,250,0)')
  ctx.fillStyle = grad
  ctx.fillRect(x - 80, h * 0.42, 160, h * 0.16)
  // 文案
  ctx.fillStyle = '#e8eaf6'
  ctx.font = '600 42px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(name || '演示画面', w / 2, h / 2 - 24)
  ctx.fillStyle = '#8b93ad'
  ctx.font = '22px system-ui, sans-serif'
  ctx.fillText(new Date().toLocaleTimeString('zh-CN', { hour12: false }), w / 2, h / 2 + 28)
  ctx.font = '18px system-ui, sans-serif'
  ctx.fillText('内置演示帧——被控端升级 Agent 1.0.19+ 后显示真实屏幕', w / 2, h / 2 + 72)
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 3

export function RdViewer({
  deviceName,
  target,
  token,
  demo,
  onDisconnect,
}: {
  deviceName: string
  target: { host: string; port: number; tls: boolean; local?: boolean }
  token: string | undefined
  demo: boolean
  onDisconnect: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const clientRef = useRef<RdClient | null>(null)
  const decodingRef = useRef(false)
  const [state, setState] = useState<RdState>(demo ? 'demo' : 'connecting')
  const [peer, setPeer] = useState<{ name: string; os: string } | null>(null)
  const [quality, setQuality] = useState(60)
  const [fps, setFps] = useState(10)
  const [capture, setCapture] = useState(true)
  const [toolbarVisible, setToolbarVisible] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [textModal, setTextModal] = useState(false)
  const [textDraft, setTextDraft] = useState('')
    const [isMobile, setIsMobile] = useState(false)

  const hideTimer = useRef<number | null>(null)
  const escTimes = useRef<number[]>([])
  const tickRef = useRef(0)

  // ---------- 触摸手势状态 ----------
  const touchRef = useRef<{
    /** 单指：起始时间/位置 */
    startTime: number
    startX: number
    startY: number
    lastX: number
    lastY: number
    longPressTimer: number | null
    moved: boolean
    /** 双指：初始距离/中点/累积滚动 */
    startDist: number
    startZoom: number
    gesture: 'none' | 'scroll' | 'pinch' | 'unknown'
    lastScrollY: number
  }>({ startTime: 0, startX: 0, startY: 0, lastX: 0, lastY: 0, longPressTimer: null, moved: false, startDist: 0, startZoom: 1, gesture: 'none', lastScrollY: 0 })

  // ---------- 画布尺寸：等比缩放黑边留白（ResizeObserver 算 CSS 尺寸） ----------
  const fitCanvas = useCallback(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas || !canvas.width || !canvas.height) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    const scale = Math.min(cw / canvas.width, ch / canvas.height)
    canvas.style.width = `${Math.floor(canvas.width * scale)}px`
    canvas.style.height = `${Math.floor(canvas.height * scale)}px`
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => fitCanvas())
    ro.observe(container)
    return () => ro.disconnect()
  }, [fitCanvas])

  useEffect(() => {
    setIsMobile(window.matchMedia('(max-width: 1023px)').matches)
  }, [])

  // ---------- 连接 ----------
  useEffect(() => {
    if (demo) {
      // demo：本地测试图案，2fps 走 rAF 节流
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width = 1280
      canvas.height = 800
      fitCanvas()
      let alive = true
      const loop = () => {
        if (!alive) return
        tickRef.current += 1
        drawDemoFrame(ctx, canvas.width, canvas.height, deviceName, tickRef.current)
        setTimeout(() => requestAnimationFrame(loop), 500)
      }
      requestAnimationFrame(loop)
      return () => {
        alive = false
      }
    }

    const canvas = canvasRef.current
    const client = new RdClient(target, token, {
      onFrame: (f) => {
        // 解码跟不上就丢帧（渲染最新）：远程桌面要的是低延迟不是完整性
        if (decodingRef.current || !canvas) return
        decodingRef.current = true
        createImageBitmap(new Blob([f.jpeg as unknown as BlobPart], { type: 'image/jpeg' }))
          .then((bmp) => {
            if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
              canvas.width = bmp.width
              canvas.height = bmp.height
                      fitCanvas()
            }
            canvas.getContext('2d')?.drawImage(bmp, 0, 0)
            bmp.close()
          })
          .catch(() => undefined)
          .finally(() => {
            decodingRef.current = false
          })
      },
      onHello: (peer) => setPeer(peer),
      onBusy: undefined, // state 已驱动覆盖层
      onState: (s) => setState(s),
      onClosed: () => undefined, // failed 态已驱动覆盖层
    })
    clientRef.current = client
    client.connect()
    return () => {
      client.dispose('silent')
      clientRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, target.host, target.port, target.tls, token, deviceName, fitCanvas])

  // ---------- 工具条自动隐藏 ----------
  const pokeToolbar = useCallback(() => {
    setToolbarVisible(true)
    if (hideTimer.current !== null) clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setToolbarVisible(false), 3500)
  }, [])
  useEffect(() => {
    pokeToolbar()
    return () => {
      if (hideTimer.current !== null) clearTimeout(hideTimer.current)
    }
  }, [pokeToolbar])

  // ---------- 输入：坐标归一（画布矩形 → 0..1） ----------
  const norm = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height))
    return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }
  }, [])

  const sendMouse = useCallback(
    (a: 'move' | 'down' | 'up' | 'dbl', b: 'l' | 'r' | 'm', clientX: number, clientY: number) => {
      const p = norm(clientX, clientY)
      if (!p) return
      clientRef.current?.send({ t: 'm', x: p.x, y: p.y, b, a })
    },
    [norm],
  )

  // ---------- PC 鼠标 ----------
  const onMouseMove = (e: React.MouseEvent) => {
    if (demo) return
    pokeToolbar()
    sendMouse('move', 'l', e.clientX, e.clientY)
  }
  const onMouseDown = (e: React.MouseEvent) => {
    if (demo) return
    const b = e.button === 2 ? 'r' : e.button === 1 ? 'm' : 'l'
    sendMouse('down', b, e.clientX, e.clientY)
  }
  const onMouseUp = (e: React.MouseEvent) => {
    if (demo) return
    const b = e.button === 2 ? 'r' : e.button === 1 ? 'm' : 'l'
    sendMouse('up', b, e.clientX, e.clientY)
  }
  const onDblClick = (e: React.MouseEvent) => {
    if (demo) return
    sendMouse('dbl', 'l', e.clientX, e.clientY)
  }
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault() // 右键属于远端，浏览器菜单必须拦
  }
  const onWheel = (e: React.WheelEvent) => {
    if (demo) return
    e.preventDefault()
    // dy 正数向上（契约）；浏览器 deltaY 正数向下
    clientRef.current?.send({ t: 'w', dy: e.deltaY < 0 ? 1 : -1 })
  }

  // ---------- 键盘（画布聚焦 + 捕获模式；Esc 三连 = 逃生口） ----------
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (demo) return
    if (e.key === 'Escape') {
      const now = Date.now()
      escTimes.current = escTimes.current.filter((t) => now - t < 1500)
      escTimes.current.push(now)
      if (escTimes.current.length >= 3) {
        escTimes.current = []
        setCapture(false)
        canvasRef.current?.blur()
        return
      }
      if (capture) e.preventDefault()
      return
    }
    if (!capture) return
    e.preventDefault()
    const vk = domKeyToVk(e.code, e.keyCode, {
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    })
    if (!vk) return
    clientRef.current?.send({ t: 'k', code: vk.code, mods: vk.mods, down: true })
  }
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (demo || !capture) return
    const vk = domKeyToVk(e.code, e.keyCode, {
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    })
    if (!vk) return
    e.preventDefault()
    clientRef.current?.send({ t: 'k', code: vk.code, mods: vk.mods, down: false })
  }

  // ---------- 触摸映射（同一 web 服务手机端） ----------
  // 参数用最小结构类型：React.Touch 与 DOM 全局 Touch 同名，直接标 Touch 会类型打架
  const dist2 = (t0: { clientX: number; clientY: number }, t1: { clientX: number; clientY: number }): number =>
    Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY)

  const onTouchStart = (e: React.TouchEvent) => {
    pokeToolbar()
    if (demo) return
    const t = touchRef.current
    if (e.touches.length === 1) {
      const p = e.touches[0]
      t.startTime = Date.now()
      t.startX = t.lastX = p.clientX
      t.startY = t.lastY = p.clientY
      t.moved = false
      t.gesture = 'unknown'
      // 长按 500ms = 右键单击
      t.longPressTimer = window.setTimeout(() => {
        if (!t.moved) {
          sendMouse('down', 'r', t.lastX, t.lastY)
          sendMouse('up', 'r', t.lastX, t.lastY)
        }
        t.longPressTimer = null
      }, 500)
    } else if (e.touches.length === 2) {
      if (t.longPressTimer !== null) { clearTimeout(t.longPressTimer); t.longPressTimer = null }
      t.startDist = dist2(e.touches[0], e.touches[1])
      t.startZoom = zoom
      t.gesture = 'unknown'
      t.lastScrollY = (e.touches[0].clientY + e.touches[1].clientY) / 2
    }
  }

  const onTouchMove = (e: React.TouchEvent) => {
    if (demo) return
    const t = touchRef.current
    if (e.touches.length === 1 && t.startTime) {
      const p = e.touches[0]
      if (!t.moved && Math.hypot(p.clientX - t.startX, p.clientY - t.startY) > 12) {
        t.moved = true
        if (t.longPressTimer !== null) { clearTimeout(t.longPressTimer); t.longPressTimer = null }
      }
      // 单指移动 = 鼠标移动（悬停）
      if (t.moved) sendMouse('move', 'l', p.clientX, p.clientY)
      t.lastX = p.clientX
      t.lastY = p.clientY
    } else if (e.touches.length === 2 && t.startDist > 0) {
      const d = dist2(e.touches[0], e.touches[1])
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2
      // 手势定型：位移方向（滚动）vs 距离变化（捏合），过阈值后锁定
      if (t.gesture === 'unknown') {
        const distRatio = d / t.startDist
        const dy = midY - t.lastScrollY
        if (Math.abs(dy) > 18 && Math.abs(distRatio - 1) < 0.06) t.gesture = 'scroll'
        else if (Math.abs(distRatio - 1) > 0.08) t.gesture = 'pinch'
      }
      if (t.gesture === 'pinch') {
        const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.startZoom * (d / t.startDist)))
        setZoom(z)
      } else if (t.gesture === 'scroll') {
        // 双指滑动 = 滚轮；步进按 40px 一格
        const step = Math.trunc((midY - t.lastScrollY) / 40)
        if (step !== 0) {
          // 指下滑 = 内容向下 = 滚轮向下 = dy 负
          clientRef.current?.send({ t: 'w', dy: -step })
          t.lastScrollY = midY
        }
      }
    }
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    if (demo) return
    const t = touchRef.current
    if (e.touches.length === 0 && t.startTime) {
      if (t.longPressTimer !== null) { clearTimeout(t.longPressTimer); t.longPressTimer = null }
      // tap：未移动、按住 <300ms → 左键单击（down+up 同点）
      if (!t.moved && Date.now() - t.startTime < 300) {
        sendMouse('down', 'l', t.startX, t.startY)
        sendMouse('up', 'l', t.startX, t.startY)
      }
      t.startTime = 0
      t.gesture = 'none'
    }
    if (e.touches.length < 2) t.startDist = 0
  }

  // ---------- 全屏 ----------
  const toggleFullscreen = () => {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen()
  }
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // ---------- 工具条动作 ----------
  const changeQuality = (q: number) => {
    setQuality(q)
    clientRef.current?.send({ t: 'q', quality: q })
  }
  const changeFps = (f: number) => {
    setFps(f)
    clientRef.current?.send({ t: 'fps', fps: f })
  }
  const sendText = () => {
    const text = textDraft
    if (!text) return
    clientRef.current?.send({ t: 'txt', text })
    setTextDraft('')
    setTextModal(false)
  }

  const statusLabel =
    state === 'connected'
      ? `已连接 ${peer?.name ? `${peer.name}（${peer.os}）` : deviceName}`
      : state === 'connecting'
        ? '连接中…'
        : state === 'reconnecting'
          ? '重连中…'
          : state === 'busy'
            ? '被控端正有其他远程会话'
            : state === 'failed'
              ? '连接失败'
              : demo
                ? '演示模式'
                : ''

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black"
      onMouseMove={pokeToolbar}
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        width={1280}
        height={800}
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onDoubleClick={onDblClick}
        onContextMenu={onContextMenu}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className={clsx(
          'outline-none select-none',
          !demo && 'cursor-default focus:ring-0',
        )}
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: 'center center',
          transition: 'width 120ms, height 120ms',
        }}
      />

      {/* 悬浮工具条：顶部居中，闲置自动隐藏 */}
      <div
        className={clsx(
          'pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 transition-all duration-200',
          toolbarVisible ? 'translate-y-0 opacity-100' : '-translate-y-14 opacity-0',
        )}
      >
        <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-line bg-surface/95 px-3 py-2 shadow-2xl backdrop-blur">
          <span
            className={clsx(
              'h-2 w-2 rounded-full',
              state === 'connected' ? 'bg-ok' : state === 'failed' ? 'bg-danger' : 'bg-warn',
            )}
          />
          <span className="max-w-[180px] truncate text-[12px] text-fg-soft sm:max-w-[280px]">
            {statusLabel}
          </span>
          <span className="mx-1 h-4 w-px bg-line-soft" />
          {/* 画质 30–90 */}
          <label className="flex items-center gap-1.5 text-[11px] text-muted">
            画质
            <input
              type="range"
              min={30}
              max={90}
              step={5}
              value={quality}
              disabled={demo}
              onChange={(e) => changeQuality(parseInt(e.target.value, 10))}
              className="w-16 accent-[var(--tone-accent)]"
            />
            <span className="num w-5 text-fg-soft">{quality}</span>
          </label>
          {/* 帧率 */}
          <select
            aria-label="帧率"
            value={fps}
            disabled={demo}
            onChange={(e) => changeFps(parseInt(e.target.value, 10))}
            className="h-7 rounded-lg border border-line-soft bg-elevated px-1.5 text-[11px] text-fg"
          >
            {[5, 10, 15, 24, 30].map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
          <span className="mx-1 h-4 w-px bg-line-soft" />
          {/* 键盘捕获开关（PC）；软键盘（手机） */}
          <button
            type="button"
            title={capture ? '键盘已捕获（Esc 三连释放）' : '键盘捕获已释放，点击开启'}
            onClick={() => setCapture((v) => !v)}
            className={clsx(
              'grid h-7 w-7 place-items-center rounded-lg border text-[11px]',
              capture
                ? 'border-accent/40 bg-accent/15 text-accent'
                : 'border-line-soft text-muted hover:text-fg-soft',
            )}
          >
            <Keyboard size={14} />
          </button>
          {isMobile && (
            <button
              type="button"
              title="发送文本"
              onClick={() => setTextModal(true)}
              className="grid h-7 w-7 place-items-center rounded-lg border border-line-soft text-muted hover:text-fg-soft"
            >
              <Type size={14} />
            </button>
          )}
          {/* 本地缩放（移动端捏合的等效按钮） */}
          {isMobile && (
            <span className="flex items-center gap-0.5 text-muted">
              <button
                type="button"
                aria-label="缩小"
                onClick={() => setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - 0.25) * 4) / 4))}
                className="grid h-7 w-7 place-items-center rounded-lg border border-line-soft"
              >
                <Minus size={13} />
              </button>
              <span className="num w-9 text-center text-[11px]">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                aria-label="放大"
                onClick={() => setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + 0.25) * 4) / 4))}
                className="grid h-7 w-7 place-items-center rounded-lg border border-line-soft"
              >
                <Plus size={13} />
              </button>
            </span>
          )}
          <button
            type="button"
            title={fullscreen ? '退出全屏' : '全屏'}
            onClick={toggleFullscreen}
            className="grid h-7 w-7 place-items-center rounded-lg border border-line-soft text-muted hover:text-fg-soft"
          >
            {fullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
          </button>
          <button
            type="button"
            title="断开并返回"
            onClick={onDisconnect}
            className="grid h-7 w-7 place-items-center rounded-lg border border-danger/40 text-danger hover:bg-danger/10"
          >
            <Unplug size={14} />
          </button>
        </div>
      </div>

      {/* 覆盖层：非 connected 的状态卡 */}
      {state !== 'connected' && !demo && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70">
          <div className="max-w-[320px] rounded-2xl border border-line bg-surface px-6 py-5 text-center shadow-2xl">
            {state === 'busy' ? (
              <>
                <MonitorOff className="mx-auto mb-3 text-warn" size={30} />
                <p className="text-[14px] font-medium text-fg">被控端正有其他远程会话</p>
                <p className="mt-1 text-[12px] text-muted">同一时刻只允许一个查看器接入，请稍后再试。</p>
              </>
            ) : state === 'failed' ? (
              <>
                <MonitorOff className="mx-auto mb-3 text-danger" size={30} />
                <p className="text-[14px] font-medium text-fg">连接失败</p>
                <p className="mt-1 text-[12px] text-muted">已自动重试 3 次仍未连上，检查被控端是否在线。</p>
                <button
                  type="button"
                  onClick={() => clientRef.current?.reconnectManually()}
                  className="mt-3 rounded-xl bg-accent px-4 py-1.5 text-[12.5px] font-medium text-white"
                >
                  手动重连
                </button>
              </>
            ) : (
              <>
                <Loader2 className="mx-auto mb-3 animate-spin text-accent" size={30} />
                <p className="text-[13.5px] text-fg-soft">{statusLabel}</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* 软键盘文本注入（手机） */}
      {textModal && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60" onClick={() => setTextModal(false)}>
          <div className="w-[min(420px,92vw)] rounded-2xl border border-line bg-surface p-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-[13px] font-medium text-fg">发送文本到被控端</p>
            <p className="mt-1 text-[11.5px] text-muted">以 Unicode 文本注入，适合手机上输中文。</p>
            <input
              autoFocus
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); sendText() }
                e.stopPropagation()
              }}
              className="mt-3 w-full rounded-xl border border-line-soft bg-elevated px-3 py-2 text-[13px] text-fg outline-none focus:border-accent"
              placeholder="输入要发送的文字…"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="rounded-xl border border-line-soft px-3 py-1.5 text-[12px] text-muted" onClick={() => setTextModal(false)}>
                取消
              </button>
              <button type="button" className="rounded-xl bg-accent px-3 py-1.5 text-[12px] font-medium text-white" onClick={sendText}>
                发送
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
