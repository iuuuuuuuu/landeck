// 手机端「从发现页切走」的卡顿实测。
// 判据：切走后主线程能否在有限时间内响应（双 rAF 的耗时），以及切走后 1.5s 内
// 还有没有在飞的请求（说明扫描没被真正收掉）。
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = process.argv[2] || 'http://127.0.0.1:8420'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

const proc = spawn(
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--remote-debugging-port=9430', '--disable-gpu', '--no-first-run',
   '--user-data-dir=' + process.cwd() + '/.tmp/edge-mnav', 'about:blank'],
  { stdio: 'ignore' },
)
for (let i = 0; i < 80; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:9430/json/list')).json()
    if (l.find((t) => t.type === 'page')) break
  } catch {}
  await sleep(250)
}
const list = await (await fetch('http://127.0.0.1:9430/json/list')).json()
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pend = new Map()
let inFlight = 0
let afterNavSends = 0
let navAt = 0
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return }
  if (m.method === 'Network.requestWillBeSent') {
    inFlight++
    if (navAt && Date.now() - navAt > 0 && Date.now() - navAt < 1500) afterNavSends++
  }
  if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') inFlight = Math.max(0, inFlight - 1)
}
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); return r.result?.value ?? r.exceptionDetails?.text }
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')

// 手机视口 + 安卓 UA（走 isPhoneOS 分支）
await send('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-G991B Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36',
  platform: 'Linux armv8l',
})
await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 873, deviceScaleFactor: 2.75, mobile: true })
await send('Emulation.setCPUThrottlingRate', { rate: 4 }) // 模拟手机 CPU
await send('Page.navigate', { url: BASE + '/' }); await sleep(2500)
await ev(`localStorage.clear()`)
await send('Page.navigate', { url: BASE + '/' }); await sleep(3000)

// 进发现页并开始扫描
await ev(`location.hash='#/scan'`); await sleep(1500)
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/扫描/.test(x.innerText||'')); if(b){b.click(); return true} return false })()`)
await sleep(1200)
const during = inFlight
console.log(`扫描中在飞请求: ${during}`)

// 切走
navAt = Date.now()
await ev(`location.hash='#/devices'`)
await sleep(400)
const latency = await ev(`(async () => { const s=performance.now(); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return Math.round(performance.now()-s) })()`)
await sleep(1500)
const after = inFlight
const sendsAfter = afterNavSends

check('切走后主线程可响应（双 rAF < 400ms，4x CPU 降速下）', typeof latency === 'number' && latency < 400, `latency=${latency}ms`)
check('切走后不再有新请求发出', sendsAfter < 20, `切走后 1.5s 内新请求=${sendsAfter}`)
check('切走后没有堆积在飞请求', after < 12, `在飞=${after}（扫描中曾有 ${during}）`)

// 再切回去，页面应能正常渲染
await ev(`location.hash='#/scan'`); await sleep(2500)
const text = await ev('document.body.innerText')
check('切回发现页仍可用', /发现|扫描/.test(text), text.slice(0, 40).replace(/\n/g, ' '))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
ws.close(); proc.kill(); process.exit(failed.length ? 1 : 0)
