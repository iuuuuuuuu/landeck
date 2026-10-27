// 诊断：设备详情页「应用与进程」的图标请求到底发生了什么
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = process.argv[2] || 'http://127.0.0.1:8420'
const pair = JSON.parse(readFileSync('.tmp/pair.json', 'utf8'))
const dev = {
  id: pair.server.id, host: '127.0.0.1', port: 8420, tls: false,
  token: pair.token, clientId: pair.clientId, name: pair.server.name,
  os: 'windows', arch: 'amd64', ver: '1.0.9', addedAt: Date.now(),
}

const proc = spawn(
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--remote-debugging-port=9440', '--disable-gpu', '--no-first-run',
   '--user-data-dir=' + process.cwd() + '/.tmp/edge-icon', 'about:blank'],
  { stdio: 'ignore' },
)
for (let i = 0; i < 80; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:9440/json/list')).json()
    if (l.find((t) => t.type === 'page')) break
  } catch {}
  await sleep(250)
}
const list = await (await fetch('http://127.0.0.1:9440/json/list')).json()
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pend = new Map()
const iconReqs = []
const reqUrl = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return }
  if (m.method === 'Network.requestWillBeSent') {
    reqUrl.set(m.params.requestId, m.params.request.url)
    if (m.params.request.url.includes('/apps/icon')) iconReqs.push({ url: m.params.request.url.slice(0, 90), status: 'pending' })
  }
  if (m.method === 'Network.responseReceived') {
    const u = m.params.response.url
    if (u.includes('/apps/icon')) {
      const hit = iconReqs.find((r) => r.status === 'pending')
      if (hit) hit.status = m.params.response.status
    }
  }
  if (m.method === 'Network.loadingFailed') {
    const u = reqUrl.get(m.params.requestId) || ''
    if (u.includes('/apps/icon')) {
      const hit = iconReqs.find((r) => r.status === 'pending')
      if (hit) hit.status = 'FAILED:' + m.params.errorText
    }
  }
}
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); return r.result?.value ?? r.exceptionDetails?.text }
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

await send('Page.navigate', { url: BASE + '/' }); await sleep(2000)
await ev(`localStorage.setItem('landeck.app.v1', ${JSON.stringify(JSON.stringify({ state: { devices: [dev], activeId: dev.id, myName: 'YG', myId: 'web' }, version: 0 }))})`)
await send('Page.navigate', { url: BASE + '/' }); await sleep(2500)

// 进详情页并滚到应用面板
await ev(`location.hash='#/devices/${dev.id}'`); await sleep(4000)
const found = await ev(`(() => {
  const nodes = [...document.querySelectorAll('*')].filter(e => /应用与进程|应用 \/ 进程/.test(e.textContent||'') && e.children.length < 5)
  return nodes.length
})()`)
console.log('应用面板标题数:', found)
// 滚到底触发 lazy
await ev(`window.scrollTo(0, document.body.scrollHeight)`); await sleep(1500)
await ev(`window.scrollBy(0, -400)`); await sleep(2500)

console.log('图标请求数:', iconReqs.length)
for (const r of iconReqs.slice(0, 6)) console.log('  ', r.status, r.url)

const imgs = await ev(`(() => {
  const list = [...document.querySelectorAll('img')].filter(i => (i.src||'').includes('/apps/icon'))
  return JSON.stringify({
    total: list.length,
    loaded: list.filter(i => i.naturalWidth > 0).length,
    broken: list.filter(i => i.complete && i.naturalWidth === 0).length,
    firstSrc: list[0] ? list[0].src.slice(0, 100) : '',
    tiles: document.querySelectorAll('li span.relative').length,
  })
})()`)
console.log('页面 img 统计:', imgs)

// 直接问接口：拿一个真实 exe 试
const probe = await ev(`(async () => {
  const r = await fetch('/api/v1/apps');
  const text = await r.text();
  const apps = JSON.parse(text.replace(/\\\\/g, '\\\\\\\\')).items || [];
  const withExe = apps.filter(a => a.exe && /\\.exe$/i.test(a.exe));
  const first = withExe[0];
  if (!first) return JSON.stringify({ apps: apps.length, withExe: 0 });
  const ir = await fetch('/api/v1/apps/icon?exe=' + encodeURIComponent(first.exe));
  return JSON.stringify({ apps: apps.length, withExe: withExe.length, sampleExe: first.exe, iconStatus: ir.status, iconType: ir.headers.get('content-type'), iconLen: (await ir.arrayBuffer()).byteLength });
})()`)
console.log('接口探针:', probe)
ws.close(); proc.kill(); process.exit(0)
