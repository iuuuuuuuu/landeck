/**
 * DOM 键盘事件 → Windows 虚拟键码（VK）映射。
 *
 * 契约（phase4 设计文档 B 节 RD-1）：输入帧 {t:"k", code:65, mods:[...], down:true}
 * 的 code 是 **Windows 虚拟键码**，agent 只认 VK，DOM→VK 的翻译全部在前端。
 *
 * 为什么不只靠 KeyboardEvent.code：code 是「物理键位」（QWERTY 的 KeyA），
 * 在非 QWERTY 布局 / 中文输入法下与 VK 的对应会漂移；而 **keyCode 在 Windows
 * 浏览器上就是 Win32 消息里的 VK 原值**，是最高保真的来源。所以策略：
 *   1. keyCode 在合法 VK 区间（8..254）→ 直接用（Windows/桌面浏览器的主路径）；
 *   2. 否则（移动端软键盘、部分合成事件）→ 查 CODE_TO_VK 表按物理键位映射；
 *   3. 都没有 → 返回 null（该键不发送，agent 端按未知键丢弃）。
 *
 * 映射表独立成文件：契约共享（与 agent-rd 对表）、可单测、后续加键不改客户端。
 */

/** 主键位表：KeyboardEvent.code → Windows VK。只列有稳定 VK 的键。 */
export const CODE_TO_VK: Record<string, number> = {
  // 字母（VK 0x41-0x5A 与 ASCII 大写对齐）
  ...Object.fromEntries(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c, i) => [`Key${c}`, 0x41 + i]),
  ),
  // 数字排（主键盘）
  ...Object.fromEntries(
    '0123456789'.split('').map((d, i) => [`Digit${d}`, 0x30 + i]),
  ),
  // 数字小键盘
  Numpad0: 0x60, Numpad1: 0x61, Numpad2: 0x62, Numpad3: 0x63, Numpad4: 0x64,
  Numpad5: 0x65, Numpad6: 0x66, Numpad7: 0x67, Numpad8: 0x68, Numpad9: 0x69,
  NumpadMultiply: 0x6a, NumpadAdd: 0x6b, NumpadSubtract: 0x6d,
  NumpadDecimal: 0x6e, NumpadDivide: 0x6f, NumpadEnter: 0x0d,

  // 功能键
  ...Object.fromEntries(
    Array.from({ length: 24 }, (_, i) => [`F${i + 1}`, 0x70 + i]),
  ),

  // 控制键
  Backspace: 0x08,
  Tab: 0x09,
  Enter: 0x0d,
  ShiftLeft: 0x10,
  ShiftRight: 0x10,
  ControlLeft: 0x11,
  ControlRight: 0x11,
  AltLeft: 0x12,
  AltRight: 0x12,
  CapsLock: 0x14,
  Escape: 0x1b,
  Space: 0x20,
  PageUp: 0x21,
  PageDown: 0x22,
  End: 0x23,
  Home: 0x24,
  ArrowLeft: 0x25,
  ArrowUp: 0x26,
  ArrowRight: 0x27,
  ArrowDown: 0x28,
  PrintScreen: 0x2c,
  Insert: 0x2d,
  Delete: 0x2e,
  MetaLeft: 0x5b,
  MetaRight: 0x5c,

  // OEM 标点（US 布局语义；非 US 布局优先走 keyCode 主路径）
  Semicolon: 0xba, // ;:
  Equal: 0xbb, // =+
  Comma: 0xbc, // ,<
  Minus: 0xbd, // -_
  Period: 0xbe, // .>
  Slash: 0xbf, // //?
  Backquote: 0xc0, // `~
  BracketLeft: 0xdb, // [{
  Backslash: 0xdc, // \|
  BracketRight: 0xdd, // ]]
  Quote: 0xde, // '"
}

export interface KeyMods {
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

/** 从键盘事件或修饰键集合提取 mods（契约只认这四个词）；缺省字段视为未按。 */
export function modsOf(e: {
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}): string[] {
  const mods: string[] = []
  if (e.ctrlKey) mods.push('ctrl')
  if (e.shiftKey) mods.push('shift')
  if (e.altKey) mods.push('alt')
  if (e.metaKey) mods.push('meta')
  return mods
}

/**
 * 键盘事件 → { vk, mods }；翻译不了返回 null。
 *
 * @param keyCode 允许调用方传事件的 keyCode（旧属性）；没传就从 code 表查。
 */
export function domKeyToVk(
  code: string,
  keyCode: number | undefined,
  mods: KeyMods,
): { code: number; mods: string[] } | null {
  // KeyMods 用短名（ctrl/shift/...），与事件的 ctrlKey/... 不同名，
  // 不能直接传 modsOf（TS 弱类型检查会拒），在这里展开成契约数组。
  const arr: string[] = []
  if (mods.ctrlKey) arr.push('ctrl')
  if (mods.shiftKey) arr.push('shift')
  if (mods.altKey) arr.push('alt')
  if (mods.metaKey) arr.push('meta')
  // keyCode 即 Windows VK（Windows 浏览器）；区间外的（0、255+）不可信
  if (keyCode !== undefined && keyCode >= 8 && keyCode <= 254) {
    return { code: keyCode, mods: arr }
  }
  const vk = CODE_TO_VK[code]
  if (vk === undefined) return null
  return { code: vk, mods: arr }
}
