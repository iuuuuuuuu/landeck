import { create } from 'zustand'
import { themeGet, themeSet } from '../lib/discovery'
import { persist } from 'zustand/middleware'

/** 用户可选的主题；'system' 跟随 prefers-color-scheme（只解析明亮/暗色）；
 *  十期 A3 起也容纳导入主题包的 id（string & {} 保住字面量提示）。 */
export type ThemeMode = 'system' | BuiltinThemeName | (string & {})
/** 内置主题（四套 token 集） */
export type BuiltinThemeName = 'dark' | 'light' | 'minimal' | 'flat'
/** 实际落到 <html data-theme> 上的值：内置 + 导入主题包的 id（十期 A3） */
export type ThemeName = BuiltinThemeName | (string & {})

/** 持久化 key：改这里要同步迁移旧数据 */
export const THEME_STORAGE_KEY = 'landeck.theme.v1'

const LIGHT_QUERY = '(prefers-color-scheme: light)'

/** 循环顺序（ThemeToggle 用）：跟随系统 -> 明亮 -> 暗色 -> 简约 -> 留白扁平 */
export const THEME_ORDER: ThemeMode[] = ['system', 'light', 'dark', 'minimal', 'flat']

export const THEME_LABEL: Record<ThemeMode, string> = {
  system: '跟随系统',
  light: '明亮',
  dark: '暗色',
  minimal: '简约',
  flat: '留白扁平',
}

/** 已解析主题的显示名（设置页「当前生效」用） */
export const THEME_NAME_LABEL: Record<ThemeName, string> = {
  light: '明亮',
  dark: '暗色',
  minimal: '简约',
  flat: '留白扁平',
}

/** 导入主题包（十期 A3）：{id, name, tokens}——tokens 是 CSS 变量键值对 */
export interface ImportedTheme {
  id: string
  name: string
  tokens: Record<string, string>
}

const IMPORTED_STORAGE_KEY = 'landeck.themes.v1'

/** 读取已导入主题（同步，启动即用） */
export function loadImportedThemes(): ImportedTheme[] {
  try {
    const raw = localStorage.getItem(IMPORTED_STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as ImportedTheme[]
    return Array.isArray(arr) ? arr.filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string') : []
  } catch {
    return []
  }
}

function saveImportedThemes(list: ImportedTheme[]): void {
  try {
    localStorage.setItem(IMPORTED_STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

/** 解析并校验主题包 JSON（导入入口的唯一校验点） */
export function parseThemePackage(json: string): ImportedTheme {
  const obj = JSON.parse(json) as { id?: unknown; name?: unknown; tokens?: unknown }
  if (typeof obj.id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(obj.id)) {
    throw new Error('invalid id')
  }
  if (typeof obj.name !== 'string' || obj.name.trim().length === 0 || obj.name.length > 40) {
    throw new Error('invalid name')
  }
  if (typeof obj.tokens !== 'object' || obj.tokens === null || Array.isArray(obj.tokens)) {
    throw new Error('invalid tokens')
  }
  const tokens: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj.tokens as Record<string, unknown>)) {
    if (!/^--[a-z0-9-]+$/i.test(k) || typeof v !== 'string') throw new Error('invalid token: ' + k)
    tokens[k] = v
  }
  if (Object.keys(tokens).length === 0) throw new Error('empty tokens')
  return { id: obj.id, name: obj.name.trim(), tokens }
}

/**
 * 把导入主题的 tokens 注入为 CSS 规则：[data-theme='<id>'] { --var: val; }。
 * 幂等（同 id 重建规则）；data-theme 切到该 id 时 tokens 即生效。
 */
function ensureCustomStyle(theme: ImportedTheme): void {
  const styleId = 'ldk-custom-theme-' + theme.id
  let style = document.getElementById(styleId) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = styleId
    document.head.appendChild(style)
  }
  const decls = Object.entries(theme.tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')
  style.textContent = `[data-theme='${theme.id}'] {
${decls}
}`
}

/** 供浏览器 UI（地址栏/状态栏）取色 */
export const THEME_CHROME: Record<ThemeName, string> = {
  dark: '#06070c',
  light: '#f2f4fb',
  minimal: '#f4f5f7',
  flat: '#ffffff',
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
  if (mode === 'minimal') return 'minimal'
  if (mode === 'flat') return 'flat'
  // 十期 A3：导入主题包 id 原样返回（data-theme 直接用）
  if (!(['system'] as string[]).includes(mode)) return mode as ThemeName
  return prefersLight ? 'light' : 'dark'
}

/** 把解析后的主题写到 <html>，顺带同步 color-scheme 与浏览器 UI 配色 */
export function applyTheme(theme: ThemeName): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (root.dataset.theme !== theme) root.dataset.theme = theme
  // 自定义主题：浅色口径（导入包基于浅色底设计）；确保 tokens 规则已注入
  if (!(['dark', 'light', 'minimal', 'flat'] as string[]).includes(theme)) {
    root.style.colorScheme = 'light'
    const imported = loadImportedThemes().find((x) => x.id === theme)
    if (imported) ensureCustomStyle(imported)
  } else {
    root.style.colorScheme = theme
  }

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = THEME_CHROME[theme as BuiltinThemeName] ?? '#ffffff'
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
/** 导入主题包：校验 -> 存 localStorage -> 注入样式规则。返回导入结果供 UI toast。 */
export function importTheme(json: string): ImportedTheme {
  const theme = parseThemePackage(json)
  const list = loadImportedThemes()
  const next = [...list.filter((x) => x.id !== theme.id), theme]
  saveImportedThemes(next)
  ensureCustomStyle(theme)
  return theme
}

/** 删除已导入主题；若正在使用则回到跟随系统。 */
export function removeImportedTheme(id: string): void {
  saveImportedThemes(loadImportedThemes().filter((x) => x.id !== id))
  document.getElementById('ldk-custom-theme-' + id)?.remove()
  if (useThemeStore.getState().theme === id) {
    useThemeStore.getState().setMode('system')
  }
}

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
  const mode = (['system', 'dark', 'light', 'minimal', 'flat'] as ThemeMode[]).find((m) => m === saved)
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
