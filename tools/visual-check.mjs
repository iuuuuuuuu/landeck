#!/usr/bin/env node
/**
 * 视觉/布局自检脚本（无第三方依赖，走 Chrome DevTools Protocol）。
 *
 * 用法：
 *   node tools/visual-check.mjs                     # 默认截 http://127.0.0.1:8420
 *   node tools/visual-check.mjs --base http://192.168.1.20:8420
 *
 * 产出：.tmp/shots/<页面>-<视口>.png
 * 依赖：本机已装 Edge 或 Chrome；Agent 正在运行且 .tmp/pair.json 里有可用 token。
 */
import { spawn } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const args = process.argv.slice(2)
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const BASE = getArg('base', 'http://127.0.0.1:8420')
const OUT = getArg('out', '.tmp/shots')
const PORT = 9333

const EDGE_PATHS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
]
const browser = EDGE_PATHS.find((p) => existsSync(p))
if (!browser) {
  console.error('找不到 Edge/Chrome')
  process.exit(2)
}

mkdirSync(OUT, { recursive: true })

let pair = null
try {
  pair = JSON.parse(readFileSync('.tmp/pair.json', 'utf8'))
} catch {
  console.error('缺少 .tmp/pair.json（先配对一次并保存响应）')
  process.exit(2)
}
const device = {
  id: pair.server.id,
  host: new URL(BASE).hostname,
  port: Number(new URL(BASE).port || 8420),
  tls: false,
  token: pair.token,
  clientId: pair.clientId,
  name: pair.server.name,
  os: 'windows',
  arch: 'amd64',
  ver: '1.0.0',
  addedAt: Date.now(),
}

const proc = spawn(
  browser,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--force-device-scale-factor=1',
    `--user-data-dir=${process.cwd()}/.tmp/edge-profile`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function cdpTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('CDP 端口没起来')
}

const wsUrl = await cdpTarget()
const ws = new WebSocket(wsUrl)
await new Promise((r) => (ws.onopen = r))

let msgId = 0
const pending = new Map()
const events = new Map()
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
  } else if (msg.method && events.has(msg.method)) {
    events.get(msg.method)()
    events.delete(msg.method)
  }
}

function send(method, params = {}) {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

function once(method) {
  return new Promise((r) => events.set(method, r))
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return res.result?.value
}

await send('Page.enable')
await send('Runtime.enable')

const shots = []
async function shot(name, { width = 1440, height = 960, hash = '#/devices', wait = 1200, scroll = 0 } = {}) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  })
  await evaluate(`location.hash = ${JSON.stringify(hash)}`)
  await sleep(wait)
  if (scroll) {
    await evaluate(`window.scrollTo(0, ${scroll})`)
    await sleep(400)
  }
  const { data } = await send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 88,
    captureBeyondViewport: false,
  })
  const file = `${OUT}/${name}-${width}.jpg`
  writeFileSync(file, Buffer.from(data, 'base64'))
  shots.push(file)
  console.log('shot', file)
}

// 1) 建立 origin 并写入配对状态
await send('Page.navigate', { url: `${BASE}/` })
await sleep(1500)
await evaluate(`
  localStorage.setItem('landeck.app.v1', ${JSON.stringify(
    JSON.stringify({ state: { devices: [device], activeId: device.id, myName: 'YG 的手机', myId: 'web' }, version: 0 }),
  )});
  true;
`)
// 显式锁定深色（headless Edge 默认 prefers-color-scheme: light）
await evaluate(`localStorage.setItem('landeck.theme.v1', JSON.stringify({ state: { mode: 'dark' }, version: 1 }))`)
await send('Page.navigate', { url: `${BASE}/` })
await sleep(1800)

await shot('devices', { hash: '#/devices' })
// 浅色主题：写 localStorage 后整页重载
await evaluate(`localStorage.setItem('landeck.theme.v1', JSON.stringify({ state: { mode: 'light' }, version: 1 }))`)
await send('Page.navigate', { url: `${BASE}/` })
await sleep(1800)
await shot('devices-light', { hash: '#/devices' })
await shot('detail-light', { hash: `#/devices/${device.id}`, wait: 2600 })
await evaluate(`localStorage.setItem('landeck.theme.v1', JSON.stringify({ state: { mode: 'dark' }, version: 1 }))`)
await send('Page.navigate', { url: `${BASE}/` })
await sleep(1600)
await shot('detail', { hash: `#/devices/${device.id}`, wait: 2600 })
await shot('detail-full', { hash: `#/devices/${device.id}`, wait: 2200, scroll: 900 })
await shot('files', { hash: '#/files', wait: 2600 })
await shot('schedules', { hash: '#/schedules', wait: 1800 })
await shot('activity', { hash: '#/activity', wait: 1600 })
await shot('settings', { hash: '#/settings', wait: 1600 })
await shot('devices-mobile', { hash: '#/devices', width: 390, height: 844 })
await shot('detail-mobile', { hash: `#/devices/${device.id}`, width: 390, height: 844, wait: 2600 })

console.log('done:', shots.length, '张')
ws.close()
proc.kill()
process.exit(0)
