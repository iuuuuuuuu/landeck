/** 非 zh-CN 语言的资源加载器。
 *
 * 历史：en/zh-TW 曾用动态 import 懒加载 chunk——实测 WebView2 下会出现
 * 「chunk 已加载但 addResourceBundle 拿到旧内容」的怪象（主包新、资源旧，
 * 语言卡切英文后部分卡片回退中文）。改为主包静态打包（en/zh-TW 各约
 * +15KB gzip），彻底消除懒加载时序问题；ja/pt/es 占位仍走动态（内容少）。
 */
import enCommon from './locales/en/common.json'
import enNav from './locales/en/nav.json'
import enSettings from './locales/en/settings.json'
import enDevices from './locales/en/devices.json'
import enLocal from './locales/en/local.json'
import enActivity from './locales/en/activity.json'
import enFiles from './locales/en/files.json'
import enSchedules from './locales/en/schedules.json'
import enAi from './locales/en/ai.json'
import enCategories from './locales/en/categories.json'
import enMemory from './locales/en/memory.json'
import enRd from './locales/en/rd.json'
import enSync from './locales/en/sync.json'
import enPlugins from './locales/en/plugins.json'
import zhTWCommon from './locales/zh-TW/common.json'
import zhTWNav from './locales/zh-TW/nav.json'
import zhTWSettings from './locales/zh-TW/settings.json'
import zhTWDevices from './locales/zh-TW/devices.json'
import zhTWLocal from './locales/zh-TW/local.json'
import zhTWActivity from './locales/zh-TW/activity.json'
import zhTWFiles from './locales/zh-TW/files.json'
import zhTWSchedules from './locales/zh-TW/schedules.json'
import zhTWAi from './locales/zh-TW/ai.json'
import zhTWCategories from './locales/zh-TW/categories.json'
import zhTWMemory from './locales/zh-TW/memory.json'
import zhTWRd from './locales/zh-TW/rd.json'
import zhTWSync from './locales/zh-TW/sync.json'
import zhTWPlugins from './locales/zh-TW/plugins.json'
import { jaCommon, ptCommon, esCommon } from './locales/stubs'

export type Lang = 'zh-CN' | 'en' | 'zh-TW' | 'ja' | 'pt' | 'es'
type Bundle = Record<string, Record<string, unknown>>

const enBundle: Bundle = {
  common: enCommon,
  nav: enNav,
  settings: enSettings,
  devices: enDevices,
  local: enLocal,
  activity: enActivity,
  files: enFiles,
  schedules: enSchedules,
  ai: enAi,
  categories: enCategories,
  memory: enMemory,
  rd: enRd,
  sync: enSync,
  plugins: enPlugins,
}

const zhTWBundle: Bundle = {
  common: zhTWCommon,
  nav: zhTWNav,
  settings: zhTWSettings,
  devices: zhTWDevices,
  local: zhTWLocal,
  activity: zhTWActivity,
  files: zhTWFiles,
  schedules: zhTWSchedules,
  ai: zhTWAi,
  categories: zhTWCategories,
  memory: zhTWMemory,
  rd: zhTWRd,
  sync: zhTWSync,
  plugins: zhTWPlugins,
}

export const enLoader = async (): Promise<Bundle> => enBundle

export const zhTWLoader = async (): Promise<Bundle> => zhTWBundle

/** ja/pt/es：框架占位（仅 common 少量条目，未覆盖 key 回退 zh-CN）——欢迎纠错后补全 */
const stubLoader = (code: 'ja' | 'pt' | 'es') => async (): Promise<Bundle> => {
  const map = { ja: jaCommon, pt: ptCommon, es: esCommon } as const
  return { common: map[code] as unknown as Record<string, unknown> }
}

/** 按语言取资源加载器 */
export const langLoaders: Record<Exclude<Lang, 'zh-CN'>, () => Promise<Bundle>> = {
  en: enLoader,
  'zh-TW': zhTWLoader,
  ja: () => stubLoader('ja')(),
  pt: () => stubLoader('pt')(),
  es: () => stubLoader('es')(),
}
