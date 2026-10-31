import { useEffect, useState } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'

/**
 * Windows 自绘标题栏（macOS/Linux 用系统原生，不渲染本组件）。
 *
 * 为什么 Windows 要自己做：Hindsight 在 macOS 上是红绿灯浮在侧栏上方，
 * Windows 的原生标题栏是另一条 32px 灰条压在页面顶上，和整页的
 * 「浮面板 + 大留白」语言完全不搭。去边框后由这里接管拖拽与三键。
 *
 * 关键实现点：
 *  - 拖拽区：整个条带 data-tauri-drag-region（双击最大化由 Tauri core 处理）；
 *    按钮容器浮在其上，pointer-events 只给按钮本身。
 *  - 关闭键走 window.close() → Rust 的 CloseRequested → 与托盘/轻量模式
 *    同一套关窗行为（普通隐藏 / 轻量销毁），不会绕过。
 *  - 最大化图标随窗口状态切换（onResized 驱动）。
 */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let alive = true
    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      const sync = async () => {
        if (alive) setMaximized(await win.isMaximized())
      }
      await sync()
      const p = await win.onResized(() => void sync())
      if (alive) unlisten = p
      else p()
    })()
    return () => {
      alive = false
      unlisten?.()
    }
  }, [])

  const doMinimize = () => void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().minimize())
  const doMaximize = () => void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize())
  const doClose = () => void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().close())

  return (
    <div className="titlebar fixed inset-x-0 top-0 z-50 h-[38px]" data-tauri-drag-region>
      {/* 右侧三键：浮在拖拽条上方，只有按钮本身可点 */}
      <div className="absolute right-0 top-0 flex h-full items-stretch">
        <button
          type="button"
          aria-label="最小化"
          className="titlebar-btn"
          onClick={doMinimize}
        >
          <Minus size={15} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          aria-label={maximized ? '还原' : '最大化'}
          className="titlebar-btn"
          onClick={doMaximize}
        >
          {maximized ? <Copy size={13} strokeWidth={1.6} className="-scale-x-100" /> : <Square size={11.5} strokeWidth={1.8} />}
        </button>
        <button
          type="button"
          aria-label="关闭"
          className="titlebar-btn titlebar-btn-close"
          onClick={doClose}
        >
          <X size={16} strokeWidth={1.6} />
        </button>
      </div>
    </div>
  )
}
