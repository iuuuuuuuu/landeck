import { useEffect, useState } from 'react'

/**
 * 运行环境判定。
 *
 * 为什么需要它：同一个 SPA 会跑在三种壳里 ——
 *   1. 浏览器（手机/电脑打开 http://ip:8420）
 *   2. Tauri 桌面端（Windows/macOS/Linux，有自己的窗口和原生能力）
 *   3. Tauri Android App
 * 有些文案只对其中一种成立：
 *   - 「开机自启」只对桌面端有意义（手机 App 没有这个概念，被控机也不是它）
 *   - 「随时从手机连上这台电脑」是给桌面端看的，手机上看就是错的
 * 之前这些文案无差别展示，手机上出现了不该有的开关和描述。
 */

export type Runtime = 'web' | 'desktop' | 'android' | 'ios' | 'unknown'

interface TauriGlobal {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

function isTauri(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as TauriGlobal
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__)
}

/** 从 UA 判断移动系统（Tauri 壳里 UA 仍带 Android/iPhone 标识） */
function mobileOS(): 'android' | 'ios' | null {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  return null
}

export function detectRuntime(): Runtime {
  const mobile = mobileOS()
  if (isTauri()) {
    if (mobile === 'android') return 'android'
    if (mobile === 'ios') return 'ios'
    return 'desktop'
  }
  return 'web'
}

/** 是否具备「管理本机自启」这类桌面端专属能力 */
export function isDesktopShell(runtime: Runtime): boolean {
  return runtime === 'desktop'
}

/** 移动端（无论浏览器还是 App）：界面要更紧凑，且不应出现桌面专属设置 */
export function isMobileLike(runtime: Runtime): boolean {
  return runtime === 'android' || runtime === 'ios' || (runtime === 'web' && isTouchDevice())
}

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0
}

/** React hook：环境在运行期不会变，算一次即可 */
export function useRuntime(): Runtime {
  const [runtime, setRuntime] = useState<Runtime>(() => detectRuntime())
  useEffect(() => {
    setRuntime(detectRuntime())
  }, [])
  return runtime
}
