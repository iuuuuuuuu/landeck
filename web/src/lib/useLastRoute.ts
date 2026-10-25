import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const KEY = 'landeck.lastRoute.v1'

/** 不值得记住的页面：一次性流程与带 id 的详情页（详情页恢复后常常指向已删除的设备） */
function worthRemembering(path: string): boolean {
  if (!path || path === '/' ) return false
  if (path.startsWith('/scan')) return false
  if (/^\/devices\/[^/]+$/.test(path)) return false
  return /^\/(local|devices|files|stats|schedules|activity|settings)\b/.test(path)
}

/**
 * 记住上次停留的页面，下次打开直接回到那里。
 *
 * 为什么不用 localStorage 里存 router state：HashRouter 的地址就在 location.hash，
 * 存一行字符串最省事，也不依赖任何路由内部状态。
 */
export function useLastRoute(): void {
  const location = useLocation()
  const navigate = useNavigate()

  // 启动时恢复一次（只在首帧、且当前是根路径时）
  useEffect(() => {
    const here = location.pathname + location.search
    if (here !== '/' && here !== '' && here !== '/devices') return
    const saved = localStorage.getItem(KEY)
    if (saved && worthRemembering(saved)) {
      navigate(saved, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 之后每次变化都记下来
  useEffect(() => {
    const here = location.pathname + location.search
    if (worthRemembering(here)) localStorage.setItem(KEY, here)
  }, [location.pathname, location.search])
}
