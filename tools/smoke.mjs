#!/usr/bin/env node
/**
 * 前端冒烟：真浏览器 + 真 Agent（无第三方依赖，走 Chrome DevTools Protocol）。
 * 检查项：路由能渲染、关键文案出现、无 console error / 无未捕获异常、窄屏不横向溢出。
 *
 * 用法：node tools/smoke.mjs [--base http://127.0.0.1:8420]
 * 退出码 0 = 全过；1 = 有失败项。
 */
import { spawn } from 'node:child_process'
import { readFileSync, mkdirSync, existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const args = process.argv.slice(2)
const getArg = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : d
}
const BASE = getArg('base', 'http://127.0.0.1:8420')
const PORT = 9334

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
]
const browser = BROWSERS.find((p) => existsSync(p))
if (!browser) {
  console.error('找不到 Edge/Chrome')
  process.exit(2)
}

const pair = JSON.parse(readFileSync('.tmp/pair.json', 'utf8'))
const host = new URL(BASE).hostname
const port = Number(new URL(BASE).port || 8420)
const device = {
  id: pair.server.id,
  host,
  port,
  tls: false,
  token: pair.token,
  clientId: pair.clientId,
  name: pair.server.name,
  os: 'windows',
  arch: 'amd64',
  ver: '1.0.0',
  addedAt: Date.now(),
}

mkdirSync('.tmp', { recursive: true })
const proc = spawn(
  browser,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${process.cwd()}/.tmp/edge-smoke`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('CDP 没起来')
}

const ws = new WebSocket(await target())
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
const consoleErrors = []
const pageErrors = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    return
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
  if (m.method === 'Runtime.exceptionThrown') {
    pageErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
  }
}
const send = (method, params = {}) => {
  const mid = ++id
  ws.send(JSON.stringify({ id: mid, method, params }))
  return new Promise((resolve, reject) => pending.set(mid, { resolve, reject }))
}
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return r.result?.value
}

await send('Page.enable')
await send('Runtime.enable')

async function viewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 })
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

async function visit(hash, wait = 1800) {
  await evalJs(`location.hash = ${JSON.stringify(hash)}`)
  await sleep(wait)
  return (await evalJs('document.body.innerText')) || ''
}

await send('Page.navigate', { url: `${BASE}/` })
await sleep(1500)
await evalJs(
  `localStorage.setItem('landeck.app.v1', ${JSON.stringify(
    JSON.stringify({ state: { devices: [device], activeId: device.id, myName: 'YG 的手机', myId: 'web' }, version: 0 }),
  )})`,
)
await send('Page.navigate', { url: `${BASE}/` })
await sleep(1800)
await viewport(1440, 960)

// 1. 设备列表
let text = await visit('#/devices')
check('设备页渲染设备名', text.includes(pair.server.name), text.slice(0, 40).replace(/\n/g, ' '))
check('设备页有导航', text.includes('设备') && text.includes('发现'))

// 2. 设备详情（真连 WS，等两帧）
text = await visit(`#/devices/${device.id}`, 3000)
check('详情页出现电源操作', text.includes('关机') && text.includes('重启'))
check('详情页出现音量', text.includes('音量'))
check('详情页出现实时状态', text.includes('CPU') || text.includes('内存'))
check('详情页出现进程面板', text.includes('进程'))
const hasPercent = await evalJs("document.body.innerText.split('%').length - 1")
check('详情页出现百分比数值', hasPercent > 0, `count=${hasPercent}`)
const wsLive = await evalJs(`(() => !/正在尝试恢复推送|实时数据重连中/.test(document.body.innerText))()`)
check('实时通道已连上（无重连提示）', wsLive === true)

// 危险动作二次确认：点「关机」应弹确认框，取消后不应发出请求
const openedConfirm = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim().startsWith('关机'))
  if (!btn) return 'no-button'
  btn.click()
  return 'clicked'
})()`)
await sleep(600)
const dialogText = await evalJs(`(() => (document.querySelector('[role="dialog"]')?.innerText || ''))()`)
const dialogOneLine = dialogText.split('\n').join(' ').slice(0, 40)
check('关机弹二次确认', openedConfirm === 'clicked' && dialogText.includes('关机'), dialogOneLine)
const cancelled = await evalJs(`(() => {
  const dlg = document.querySelector('[role="dialog"]')
  if (!dlg) return false
  const btns = [...dlg.querySelectorAll('button')]
  const cancel = btns.find((b) => /取消|暂不|返回|再想想|关闭/.test(b.innerText || ''))
  if (!cancel) return false
  cancel.click()
  return true
})()`)
check('确认框可取消', cancelled === true)

// 3. 定时任务
text = await visit('#/schedules')
check('定时页渲染', text.includes('定时'), text.slice(0, 30).replace(/\n/g, ' '))

// 4. 活动日志
text = await visit('#/activity')
check('活动页渲染', text.includes('活动') || text.includes('日志'))

// 5. 设置
text = await visit('#/settings')
check('设置页渲染', text.includes('设置') || text.includes('配对'))

// 6. 发现页 + 真扫描
text = await visit('#/scan', 2500)
check('发现页渲染', text.includes('扫描') || text.includes('发现'))
const scanCtl = await evalJs(`(() => {
  const texts = [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim())
  const scanning = texts.some((t) => /停止|取消扫描/.test(t))
  if (scanning) return 'auto'
  const btn = [...document.querySelectorAll('button')].find((b) => /扫描/.test(b.innerText || ''))
  if (!btn) return 'none'
  btn.click()
  return 'clicked'
})()`)
check('发现页有扫描入口（自动或手动）', scanCtl === 'auto' || scanCtl === 'clicked', String(scanCtl))
await sleep(9000)
const scanText = await evalJs('document.body.innerText')
check('扫描能发现本机 Agent', scanText.includes(pair.server.name), scanText.split('\n').join(' ').slice(0, 60))

// 7. 窄屏不横向溢出
await viewport(390, 844)
for (const [name, hash] of [
  ['设备列表', '#/devices'],
  ['设备详情', `#/devices/${device.id}`],
  ['设置', '#/settings'],
]) {
  await visit(hash, 2200)
  const overflow = await evalJs('document.documentElement.scrollWidth - window.innerWidth')
  check(`390 宽无横向溢出（${name}）`, overflow <= 1, `overflow=${overflow}`)
}

// 8. 控制台干净
check('无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
check('无 console.error', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (pageErrors.length) console.log('异常：', pageErrors.slice(0, 3))
if (consoleErrors.length) console.log('console.error：', consoleErrors.slice(0, 5))
ws.close()
proc.kill()
process.exit(failed.length ? 1 : 0)
