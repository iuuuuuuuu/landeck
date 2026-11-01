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
import jaCommon from './locales/ja/common.json'
import jaNav from './locales/ja/nav.json'
import jaSettings from './locales/ja/settings.json'
import jaDevices from './locales/ja/devices.json'
import jaLocal from './locales/ja/local.json'
import jaActivity from './locales/ja/activity.json'
import jaFiles from './locales/ja/files.json'
import jaSchedules from './locales/ja/schedules.json'
import jaAi from './locales/ja/ai.json'
import jaCategories from './locales/ja/categories.json'
import jaMemory from './locales/ja/memory.json'
import jaRd from './locales/ja/rd.json'
import jaSync from './locales/ja/sync.json'
import ptCommon from './locales/pt/common.json'
import ptNav from './locales/pt/nav.json'
import ptSettings from './locales/pt/settings.json'
import ptDevices from './locales/pt/devices.json'
import ptLocal from './locales/pt/local.json'
import ptActivity from './locales/pt/activity.json'
import ptFiles from './locales/pt/files.json'
import ptSchedules from './locales/pt/schedules.json'
import ptAi from './locales/pt/ai.json'
import ptCategories from './locales/pt/categories.json'
import ptMemory from './locales/pt/memory.json'
import ptRd from './locales/pt/rd.json'
import ptSync from './locales/pt/sync.json'
import esCommon from './locales/es/common.json'
import esNav from './locales/es/nav.json'
import esSettings from './locales/es/settings.json'
import esDevices from './locales/es/devices.json'
import esLocal from './locales/es/local.json'
import esActivity from './locales/es/activity.json'
import esFiles from './locales/es/files.json'
import esSchedules from './locales/es/schedules.json'
import esAi from './locales/es/ai.json'
import esCategories from './locales/es/categories.json'
import esMemory from './locales/es/memory.json'
import esRd from './locales/es/rd.json'
import esSync from './locales/es/sync.json'

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

const jaBundle: Bundle = {
  common: jaCommon,
  nav: jaNav,
  settings: jaSettings,
  devices: jaDevices,
  local: jaLocal,
  activity: jaActivity,
  files: jaFiles,
  schedules: jaSchedules,
  ai: jaAi,
  categories: jaCategories,
  memory: jaMemory,
  rd: jaRd,
  sync: jaSync,
}

export const jaLoader = async (): Promise<Bundle> => jaBundle

const ptBundle: Bundle = {
  common: ptCommon,
  nav: ptNav,
  settings: ptSettings,
  devices: ptDevices,
  local: ptLocal,
  activity: ptActivity,
  files: ptFiles,
  schedules: ptSchedules,
  ai: ptAi,
  categories: ptCategories,
  memory: ptMemory,
  rd: ptRd,
  sync: ptSync,
}

export const ptLoader = async (): Promise<Bundle> => ptBundle

const esBundle: Bundle = {
  common: esCommon,
  nav: esNav,
  settings: esSettings,
  devices: esDevices,
  local: esLocal,
  activity: esActivity,
  files: esFiles,
  schedules: esSchedules,
  ai: esAi,
  categories: esCategories,
  memory: esMemory,
  rd: esRd,
  sync: esSync,
}

export const esLoader = async (): Promise<Bundle> => esBundle

/** 按语言取资源加载器 */
export const langLoaders: Record<Exclude<Lang, 'zh-CN'>, () => Promise<Bundle>> = {
  en: enLoader,
  'zh-TW': zhTWLoader,
  ja: jaLoader,
  pt: ptLoader,
  es: esLoader,
}
