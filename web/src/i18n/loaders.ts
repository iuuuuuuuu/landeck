/** 非 zh-CN 语言的懒加载器：返回该语言全部命名空间资源。 */
export type Lang = 'zh-CN' | 'en' | 'zh-TW' | 'ja' | 'pt' | 'es'
type Bundle = Record<string, Record<string, unknown>>

export const enLoader = async (): Promise<Bundle> => {
  const [common, nav, settings, devices, local, activity, files, schedules, ai, rd] = await Promise.all([
    import('./locales/en/common.json'),
    import('./locales/en/nav.json'),
    import('./locales/en/settings.json'),
    import('./locales/en/devices.json'),
    import('./locales/en/local.json'),
    import('./locales/en/activity.json'),
    import('./locales/en/files.json'),
    import('./locales/en/schedules.json'),
    import('./locales/en/ai.json'),
    import('./locales/en/rd.json'),
  ])
  return {
    common: common.default,
    nav: nav.default,
    settings: settings.default,
    devices: devices.default,
    local: local.default,
    activity: activity.default,
    files: files.default,
    schedules: schedules.default,
    ai: ai.default,
    rd: rd.default,
  }
}

const zhTWLoader = async (): Promise<Bundle> => {
  const [common, nav, settings, devices, local, activity, files, schedules, ai, rd] = await Promise.all([
    import('./locales/zh-TW/common.json'),
    import('./locales/zh-TW/nav.json'),
    import('./locales/zh-TW/settings.json'),
    import('./locales/zh-TW/devices.json'),
    import('./locales/zh-TW/local.json'),
    import('./locales/zh-TW/activity.json'),
    import('./locales/zh-TW/files.json'),
    import('./locales/zh-TW/schedules.json'),
    import('./locales/zh-TW/ai.json'),
    import('./locales/zh-TW/rd.json'),
  ])
  return {
    common: common.default,
    nav: nav.default,
    settings: settings.default,
    devices: devices.default,
    local: local.default,
    activity: activity.default,
    files: files.default,
    schedules: schedules.default,
    ai: ai.default,
    rd: rd.default,
  }
}

/** ja/pt/es：框架占位（仅 common 少量条目，未覆盖 key 回退 zh-CN）——欢迎纠错后补全 */
const stubLoader = (code: 'ja' | 'pt' | 'es') => async (): Promise<Bundle> => {
  const m = await import('./locales/stubs.ts')
  const map = { ja: m.jaCommon, pt: m.ptCommon, es: m.esCommon } as const
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
