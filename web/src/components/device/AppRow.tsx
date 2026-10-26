import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '../ui'
import { ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { appIconUrl, sameOriginIconUrl } from '../../lib/api'
import type { AppGroup } from '../../lib/types'
import { useApp } from '../../store/app'
import { hasIconSource, initialOf, memLabel, toneOf } from './appMeta'

/**
 * 「这一行接近视口了没」。
 * 应用列表一屏能有几十行，全都直接 <img> 就是几十个并发请求，
 * 所以先用 IntersectionObserver 把范围收到视口附近（多预留 240px），
 * 真正滚到哪儿才拉哪儿的图标；浏览器 HTTP 缓存 + 服务端 Cache-Control 兜住后续切换。
 */
function useNearViewport(margin = '240px') {
  const ref = useRef<HTMLLIElement | null>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    if (near) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          io.disconnect()
        }
      },
      { rootMargin: margin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [near, margin])

  return { ref, near }
}

/** 这一行属于哪台设备：路由里的 :id 优先，其次全局选中的设备 */
function useIconTarget() {
  const routeId = useParams<{ id?: string }>().id
  return useApp((s) => s.devices.find((d) => d.id === (routeId ?? s.activeId)) ?? s.devices[0])
}

/** 单行应用：点击行展开细节，右侧「结束」按钮冒泡拦截 */
export function AppRow({
  app,
  expanded,
  onToggle,
  onKill,
  onKillAll,
  killing,
}: {
  app: AppGroup
  expanded: boolean
  onToggle: () => void
  onKill: () => void
  onKillAll: () => void
  killing: boolean
}) {
  const hot = app.cpu > 50
  const row = useNearViewport()
  const device = useIconTarget()
  const [iconFailed, setIconFailed] = useState(false)
  const [iconLoaded, setIconLoaded] = useState(false)

  // 图标地址：优先走当前设备的 Agent（带令牌），拿不到设备时退回同源（浏览器里 SPA 就是 Agent 发的）
  const iconUrl = useMemo(() => {
    if (!hasIconSource(app.exe)) return ''
    if (device) {
      return appIconUrl(
        { host: device.host, port: device.port, tls: device.tls, local: device.local },
        device.local ? undefined : device.token,
        app.exe,
      )
    }
    return sameOriginIconUrl(app.exe)
  }, [device, app.exe])

  // 图片没成功前保留原来的首字母色块：加载中不会闪空白，加载完再让位给真图标
  const showTile = !iconLoaded || iconFailed
  const showImage = iconUrl !== '' && !iconFailed && row.near

  return (
    <li ref={row.ref} className="border-b border-line-soft last:border-0">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover"
      >
        <span
          className={clsx(
            'relative grid h-8 w-8 shrink-0 place-items-center',
            showTile && 'rounded-[10px] border text-[13px] font-semibold',
            showTile && toneOf(app.key),
          )}
          aria-hidden
        >
          {showTile && initialOf(app.name)}
          {showImage && (
            <img
              src={iconUrl}
              alt=""
              width={24}
              height={24}
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={() => setIconLoaded(true)}
              onError={() => setIconFailed(true)}
              className={clsx(
                'h-6 w-6 rounded-[6px] object-contain',
                iconLoaded ? 'block' : 'absolute inset-0 m-auto opacity-0',
              )}
            />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] text-fg" title={app.name}>
            {app.name}
          </span>
          <span className="block truncate text-[10.5px] text-faint">
            <span className="num">x {app.count}</span> 个进程
            {/* 窄屏没有独立列，CPU / 内存并进副标题 */}
            <span className="sm:hidden">
              {' · '}
              <span className={clsx('num', hot && 'text-warn')}>{app.cpu.toFixed(1)}%</span>
              {' · '}
              <span className="num">{memLabel(app.memMb)}</span>
            </span>
            {app.user ? <span className="hidden sm:inline"> · {app.user}</span> : null}
          </span>
        </span>

        <span
          className={clsx(
            'num hidden w-11 shrink-0 text-right text-[11.5px] sm:block',
            hot ? 'text-warn' : 'text-muted',
          )}
        >
          {app.cpu.toFixed(1)}%
        </span>
        <span className="num hidden w-12 shrink-0 text-right text-[11px] text-muted sm:block">
          {memLabel(app.memMb)}
        </span>

        <span className="flex w-[64px] shrink-0 justify-end sm:w-[72px]">
          {app.protected ? (
            <Button
              size="sm"
              variant="ghost"
              disabled
              title="系统关键应用，结束它会让电脑不可用"
              className="h-10 px-1.5 text-[11px] sm:h-8 sm:px-2"
            >
              <ShieldAlert size={12} className="shrink-0" />
              <span className="hidden sm:inline">系统应用</span>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              loading={killing}
              className="h-10 px-2.5 text-[11.5px] hover:bg-danger/12 hover:text-danger sm:h-8 sm:px-2"
              onClick={(e) => {
                e.stopPropagation()
                onKill()
              }}
            >
              结束
            </Button>
          )}
        </span>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mb-2 ml-[42px] mr-2 space-y-1 rounded-lg bg-elevated px-2.5 py-2 text-[11.5px]">
              <Detail label="进程数" value={`${app.count}`} mono />
              <Detail label="主 PID" value={String(app.mainPid)} mono />
              <Detail label="可执行" value={app.exe || '—'} mono />
              <Detail label="用户" value={app.user || '—'} />
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="min-w-0 flex-1 truncate text-[11px] text-faint" title={app.pids.join(', ')}>
                  PID <span className="num">{app.pids.slice(0, 12).join(' ')}</span>
                  {app.pids.length > 12 ? ' …' : ''}
                </span>
                {app.protected ? (
                  <span className="text-[11px] text-faint">系统应用，禁止结束</span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={killing}
                    className="h-10 px-3 text-[11.5px] hover:bg-danger/12 hover:text-danger sm:h-8 sm:px-2.5"
                    onClick={(e) => {
                      e.stopPropagation()
                      onKillAll()
                    }}
                  >
                    结束全部 {app.count} 个进程
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 gap-2">
      <span className="w-14 shrink-0 text-faint">{label}</span>
      <span
        className={clsx('min-w-0 break-all text-fg-soft', mono && 'font-mono text-[11px]')}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}
