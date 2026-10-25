import { create } from 'zustand'
import { themeGet, themeSet } from '../lib/discovery'
import { persist } from 'zustand/middleware'

/** 用户可选的三态；'system' 跟随 prefers-color-scheme */
export type ThemeMode = 'system' | 'dark' | 'light'
/** 实际落到 <html data-theme> 上的值 */
export type ThemeName = 'dark' | 'light'

/** 持久化 key：改这里要同步迁移旧数据 */
export const THEME_STORAGE_KEY = 'landeck.theme.v1'

const LIGHT_QUERY = '(prefers-color-scheme: light)'

/** 三态循环顺序（TopBar 图标按钮用） */
export const THEME_ORDER: ThemeMode[] = ['system', 'dark', 'light']

export const THEME_LABEL: Record<ThemeMode, string> = {
  system: '跟随系统',
  dark: '深色',
  light: '浅色',
}

/** 供浏览器 UI（地址栏/状态栏）取色 */
export const THEME_CHROME: Record<ThemeName, string> = {
  dark: '#06070c',
  light: '#f2f4fb',
}

function mediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(LIGHT_QUERY)
}

function systemPrefersLight(): boolean {
  return mediaQuery()?.matches ?? false
}

export function resolveTheme(mode: ThemeMode, prefersLight = systemPrefersLight()): ThemeName {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  return prefersLight ? 'light' : 'dark'
}

/** 把解析后的主题写到 <html>，顺带同步 color-scheme 与浏览器 UI 配色 */
export function applyTheme(theme: ThemeName): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (root.dataset.theme !== theme) root.dataset.theme = theme
  root.style.colorScheme = theme

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = THEME_CHROME[theme]
}

interface ThemeState {
  mode: ThemeMode
  /** 系统当前是否偏好浅色，用于 mode === 'system' 时实时跟随 */
  systemLight: boolean
  /** 已解析的实际主题，组件读它来决定图标 */
  theme: ThemeName
  setMode: (mode: ThemeMode) => void
  /** 三态循环：跟随系统 → 深色 → 浅色 → 跟随系统 */
  cycle: () => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'system',
      systemLight: systemPrefersLight(),
      theme: resolveTheme('system'),

      setMode: (mode) => {
        const theme = resolveTheme(mode, get().systemLight)
        applyTheme(theme)
        set({ mode, theme })
        // 桌面端额外落盘：WebView 的 localStorage 在某些环境下会被清空，
        // 只靠 zustand persist 会出现「选了深色，重启又变回跟随系统」。
        void themeSet(mode)
      },

      cycle: () => {
        const { mode, setMode } = get()
        const next = THEME_ORDER[(THEME_ORDER.indexOf(mode) + 1) % THEME_ORDER.length]
        setMode(next)
      },
    }),
    {
      name: THEME_STORAGE_KEY,
      version: 1,
      partialize: (s) => ({ mode: s.mode }),
      // 只合并 mode，其余字段按当前系统偏好重新解析，避免存着过期的 theme
      merge: (persisted, current) => {
        const mode = (persisted as { mode?: ThemeMode } | undefined)?.mode ?? current.mode
        return {
          ...current,
          mode,
          systemLight: systemPrefersLight(),
          theme: resolveTheme(mode),
        }
      },
    },
  ),
)

/**
 * 启动时调用一次：先落 data-theme 再让 React 渲染（防闪烁），
 * 并挂上 prefers-color-scheme 监听，跟随系统时实时切换。
 */
export function initTheme(): void {
  // 先按本地存储渲染（防闪烁），随后异步用磁盘值覆盖
  applyTheme(useThemeStore.getState().theme)
  void hydrateFromDisk()

  const mq = mediaQuery()
  if (!mq) return

  const sync = (prefersLight: boolean) => {
    const { mode } = useThemeStore.getState()
    const theme = resolveTheme(mode, prefersLight)
    applyTheme(theme)
    useThemeStore.setState({ systemLight: prefersLight, theme })
  }

  const onChange = (e: MediaQueryListEvent) => sync(e.matches)
  mq.addEventListener('change', onChange)
  // 首帧系统偏好可能与 store 初始化时不同（例如首帧前系统改了设置）
  sync(mq.matches)
}

/**
 * 桌面端从磁盘恢复主题。
 * 顺序：磁盘 > localStorage。磁盘是权威来源，因为它的位置不随 WebView 数据目录变化。
 */
async function hydrateFromDisk(): Promise<void> {
  const saved = await themeGet()
  if (!saved) return
  const mode = (['system', 'dark', 'light'] as ThemeMode[]).find((m) => m === saved)
  if (!mode) return
  const { mode: current } = useThemeStore.getState()
  if (current === mode) return
  const theme = resolveTheme(mode, systemPrefersLight())
  applyTheme(theme)
  useThemeStore.setState({ mode, theme, systemLight: systemPrefersLight() })
}

/** 组件唯一入口 */
export function useTheme() {
  const mode = useThemeStore((s) => s.mode)
  const theme = useThemeStore((s) => s.theme)
  const systemLight = useThemeStore((s) => s.systemLight)
  const setMode = useThemeStore((s) => s.setMode)
  const cycle = useThemeStore((s) => s.cycle)
  return { mode, theme, systemLight, setMode, cycle }
}
