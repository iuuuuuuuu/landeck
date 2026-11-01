import i18next, { type i18n as I18n } from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'

export type Lang = 'zh-CN' | 'en' | 'zh-TW' | 'ja' | 'pt' | 'es'

export const LANG_STORAGE_KEY = 'landeck.lang.v1'

/** 语言显示名（菜单里永远用各自语言写自己，不翻译） */
export const LANG_LABEL: Record<Lang, string> = {
  'zh-CN': '简体中文',
  en: 'English',
  'zh-TW': '繁體中文',
  ja: '日本語',
  pt: 'Português',
  es: 'Español',
}

export const LANGS: Lang[] = ['zh-CN', 'en', 'zh-TW', 'ja', 'pt', 'es']

const FALLBACK: Lang = 'zh-CN'

/** 源语言资源：静态 import，打包进主包（兜底，永不缺 key） */
import zhCNCommon from './locales/zh-CN/common.json'
import zhCNNav from './locales/zh-CN/nav.json'
import zhCNSettings from './locales/zh-CN/settings.json'
import zhCNDevices from './locales/zh-CN/devices.json'
import zhCNLocal from './locales/zh-CN/local.json'
import zhCNActivity from './locales/zh-CN/activity.json'
import zhCNFiles from './locales/zh-CN/files.json'
import zhCNSchedules from './locales/zh-CN/schedules.json'
import zhCNAi from './locales/zh-CN/ai.json'
import zhCNRd from './locales/zh-CN/rd.json'
import zhCNSync from './locales/zh-CN/sync.json'
import zhCNPlugins from './locales/zh-CN/plugins.json'

const zhCN: Bundle = {
  common: zhCNCommon,
  nav: zhCNNav,
  settings: zhCNSettings,
  devices: zhCNDevices,
  local: zhCNLocal,
  activity: zhCNActivity,
  files: zhCNFiles,
  schedules: zhCNSchedules,
  ai: zhCNAi,
  rd: zhCNRd,
  sync: zhCNSync,
  plugins: zhCNPlugins,
}

type Bundle = Record<string, Record<string, unknown>>

/** 非 zh-CN 语言的懒加载器（loaders.ts：en/zh-TW 全量九 ns；ja/pt/es 仅 common 占位） */
const LOADERS: Record<Exclude<Lang, 'zh-CN'>, () => Promise<Bundle>> = {
  en: () => import('./loaders').then((m) => m.langLoaders.en()),
  'zh-TW': () => import('./loaders').then((m) => m.langLoaders['zh-TW']()),
  ja: () => import('./loaders').then((m) => m.langLoaders.ja()),
  pt: () => import('./loaders').then((m) => m.langLoaders.pt()),
  es: () => import('./loaders').then((m) => m.langLoaders.es()),
}

/** 系统 navigator.language -> 支持的语言（zh-TW/zh-HK/zh-Hant 归繁体，其余 zh 归简体） */
export function detectSystemLang(): Lang {
  const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []
  for (const raw of langs) {
    if (!raw) continue
    const l = raw.toLowerCase()
    if (l.startsWith('zh-tw') || l.startsWith('zh-hk') || l.startsWith('zh-hant')) return 'zh-TW'
    if (l.startsWith('zh')) return 'zh-CN'
    if (l.startsWith('en')) return 'en'
    if (l.startsWith('ja')) return 'ja'
    if (l.startsWith('pt')) return 'pt'
    if (l.startsWith('es')) return 'es'
  }
  return FALLBACK
}

function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as string[]).includes(v)
}

/** 当前界面语言（非 React 代码的同步读取口） */
export function currentLang(): Lang {
  return (i18next.resolvedLanguage as Lang) || FALLBACK
}

/** 把语言写进 agent 接口约定键（AI 提示词语言跟随，agent-ai 批会读） */
function persistLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    /* ignore */
  }
}

/** 惰性加载非源语言资源并合并进 i18next（幂等）。 */
async function ensureResources(lang: Lang): Promise<void> {
  if (lang === FALLBACK) return
  if (i18next.hasResourceBundle(lang, 'common')) return
  // lang 此时必非 zh-CN（上面已 return），断言收窄索引类型
  const bundle = await LOADERS[lang as Exclude<Lang, 'zh-CN'>]()
  for (const [ns, data] of Object.entries(bundle)) {
    i18next.addResourceBundle(lang, ns, data, true, true)
  }
}

let started = false

/** 应用启动时调用一次。 */
export async function initI18n(): Promise<void> {
  if (started) return
  started = true
  if (typeof window !== 'undefined') {
    ;(window as unknown as Record<string, unknown>).__LD_I18N__ = i18next
  }

  await i18next.use(initReactI18next).init({
    lng: FALLBACK,
    fallbackLng: FALLBACK,
    resources: { 'zh-CN': zhCN },
    ns: Object.keys(zhCN),
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    returnEmptyString: false,
  })

  // 恢复持久化语言；没存过则跟随系统
  let saved: Lang | null = null
  try {
    const raw = localStorage.getItem(LANG_STORAGE_KEY)
    saved = isLang(raw) ? raw : null
  } catch {
    /* ignore */
  }
  const lang = saved ?? detectSystemLang()
  await setLang(lang, { persist: saved !== null })
}

/** 切换语言：懒加载资源 -> changeLanguage（react 组件自动重渲染，无需刷新）。 */
export async function setLang(lang: Lang, opts: { persist?: boolean } = {}): Promise<void> {
  await ensureResources(lang)
  await i18next.changeLanguage(lang)
  if (opts.persist !== false) persistLang(lang)
}

/**
 * 跟随系统模式下的系统语言变化：语言切换发生在系统设置里，
 * WebView 通常会重载页面；桌面浏览器支持 languagechange 事件的场景下实时跟随。
 * 用户显式选过语言（localStorage 有值）则不跟随。
 */
export function watchSystemLang(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('languagechange', () => {
    let explicit = false
    try {
      explicit = localStorage.getItem(LANG_STORAGE_KEY) != null
    } catch {
      /* ignore */
    }
    if (!explicit) void setLang(detectSystemLang(), { persist: false })
  })
}

export function getI18n(): I18n {
  if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__LD_I18N__ = i18next
  return i18next
}

export default i18next

/**
 * 组件取翻译函数的统一入口：useT('nav') / useT()（common）。
 * 包一层是为了把 ns 约定收口——页面直接 useTranslation() 会让 ns 字符串散落。
 */
export function useT(ns = 'common'): (key: string, opts?: Record<string, unknown>) => string {
  const { t } = useTranslation(ns)
  return t as (key: string, opts?: Record<string, unknown>) => string
}
