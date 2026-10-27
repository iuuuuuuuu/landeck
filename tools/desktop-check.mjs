#!/usr/bin/env node
/**
 * 桌面端（Tauri + WebView2）真机自检：连 WebView2 的 CDP，在真实壳里验证功能。
 *
 * 用法：
 *   powershell: $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9339"
 *   node tools/desktop-check.mjs
 *
 * 退出码 0 = 全过。
 */
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = Number(process.argv[2] || 9339)
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
      if (page) return page
    } catch {}
    await sleep(300)
  }
  throw new Error('连不上 WebView2 CDP，确认用 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 启动过')
}

const page = await targets()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
const consoleErrors = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { resolve } = pending.get(m.id)
    pending.delete(m.id)
    resolve(m.result)
    return
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
}
const send = (method, params = {}) => {
  const mid = ++id
  ws.send(JSON.stringify({ id: mid, method, params }))
  return new Promise((resolve) => pending.set(mid, { resolve }))
}
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  return r.result?.value
}

await send('Runtime.enable')

// 1. 确认真的跑在 Tauri 壳里，且原生接口可用（这正是之前扫不到的根因）
const env = await ev(`(() => ({
  href: location.href,
  hasTauri: !!window.__TAURI__,
  hasInternals: !!window.__TAURI_INTERNALS__,
  hasInvoke: !!(window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke)
}))()`)
check('运行在 Tauri 壳内（tauri.localhost）', /tauri\.localhost|localhost/.test(env.href), env.href)
check('window.__TAURI__ 已注入', env.hasTauri === true, String(env.hasTauri))
check('invoke 可用', env.hasInvoke === true, String(env.hasInvoke))

// 2. 原生命令必须能返回本机地址（前端靠它推导网段）
const ip = await ev(
  `window.__TAURI__.core.invoke('local_ip').catch(e => 'ERR:' + e)`,
)
const ipParts = String(ip).split('.')
const isDigits = (s) => s.length > 0 && [...s].every((c) => c >= '0' && c <= '9')
check(
  'local_ip 返回私有地址',
  ipParts.length === 4 &&
    ipParts.every(isDigits) &&
    (ipParts[0] === '10' || ipParts[0] === '192' || ipParts[0] === '172'),
  String(ip),
)

// 3. 原生 UDP 扫描必须发现本机 Agent
const found = await ev(
  `window.__TAURI__.core.invoke('scan_lan').then(n => n.map(x => x.name + '@' + x.ip + ':' + x.port))`,
)
check('原生扫描发现设备', Array.isArray(found) && found.length > 0, JSON.stringify(found).slice(0, 120))

// 4. 自启开关可读写（先读原值，改一次，再改回去）
const autoBefore = await ev(`window.__TAURI__.core.invoke('autostart_get')`)
const autoOn = await ev(`window.__TAURI__.core.invoke('autostart_set', { enabled: true })`)
const autoOff = await ev(`window.__TAURI__.core.invoke('autostart_set', { enabled: false })`)
await ev(`window.__TAURI__.core.invoke('autostart_set', { enabled: ${autoBefore === true} })`)
check('autostart 可读取', typeof autoBefore === 'boolean', String(autoBefore))
check('autostart 可开启', autoOn === true, String(autoOn))
check('autostart 可关闭', autoOff === false, String(autoOff))

// 5. 走真实 UI：点「扫描」后页面上必须出现设备名
await ev(`location.hash = '#/scan'`)
await sleep(1200)
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /扫描/.test(x.innerText || ''))
  if (b) b.click()
  return !!b
})()`)
await sleep(7000)
const scanText = await ev('document.body.innerText')
check('发现页扫到设备', /\d+\.\d+\.\d+\.\d+/.test(scanText), scanText.split('\n').join(' ').slice(0, 90))

// 6. 浅色主题
await ev(`localStorage.setItem('landeck.theme.v1', JSON.stringify({ state: { mode: 'light' }, version: 1 }))`)
await send('Page.reload')
await sleep(2500)
const theme = await ev(`document.documentElement.getAttribute('data-theme')`)
check('浅色主题生效', theme === 'light', String(theme))
await ev(`localStorage.setItem('landeck.theme.v1', JSON.stringify({ state: { mode: 'dark' }, version: 1 }))`)

check('无 console.error', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
ws.close()
process.exit(failed.length ? 1 : 0)
