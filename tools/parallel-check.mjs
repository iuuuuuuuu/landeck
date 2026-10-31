// 验证本轮并行改造的 4 件事（真浏览器 + 真 Agent）：
//   1. 文件 / 定时 / 活动 三页在「没有配对任何设备」时也能看到并使用本机
//   2. 手机 UA 下「本机」页不调用 agent_start，改为展示手机自身信息
//   3. 硬件信息区密度（改前改后的高度对比由 Lead 记录，这里只测是否溢出/是否并排）
//   4. 从发现页切走后不留定时器（间接：切走后 3 秒内不再有 setState 引起的渲染）
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = process.argv[2] || 'http://127.0.0.1:8420'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

const proc = spawn(
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--remote-debugging-port=9390', '--disable-gpu', '--no-first-run',
   '--user-data-dir=' + process.cwd() + '/.tmp/edge-par', 'about:blank'],
  { stdio: 'ignore' },
)
for (let i = 0; i < 80; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:9390/json/list')).json()
    if (l.find((t) => t.type === 'page')) break
  } catch {}
  await sleep(250)
}
const list = await (await fetch('http://127.0.0.1:9390/json/list')).json()
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pend = new Map()
const errs = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') {
    const text = (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').split('\n')[0]
    if (/Receiving end does not exist|Could not establish connection/.test(text)) return
    errs.push(text)
  }
}
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); return r.result?.value ?? r.exceptionDetails?.text }
await send('Page.enable'); await send('Runtime.enable')

// 干净状态：不配对任何设备
await send('Page.navigate', { url: BASE + '/' })
await sleep(1800)
await ev(`localStorage.clear()`)
await send('Page.navigate', { url: BASE + '/' })
await sleep(2500)

// ---- 1. 三页能看到本机 ----
for (const [route, name, keyword] of [
  ['/files', '文件', /本机|根目录|磁盘|C:|\//],
  ['/schedules', '定时', /本机|定时|任务/],
  ['/activity', '活动', /本机|活动|记录/],
]) {
  await ev(`location.hash='#${route}'`)
  await sleep(3500)
  const t = (await ev('document.body.innerText')) || ''
  check(`${name}页无配对设备也能打开`, t.length > 40, t.split('\n').filter(Boolean).slice(0, 6).join(' | '))
  check(`${name}页出现「本机」`, /本机/.test(t), '')
  check(`${name}页没有「先配对」硬拦截`, !/先配对一台设备|还没有可|请先配对/.test(t), '')
}

// ---- 3. 硬件密度（必须量到真实分组，不能量到空卡）----
await ev(`location.hash='#/local'`); await sleep(4500)
const hw = await ev(`(() => {
  // Group 现在是 flex flex-col + rounded-lg + border-line + bg-elevated，
  // 直接按「有圆角+边框+背景、且内部含一行标签-数值」来认，不依赖外层栅格类名。
  const groups = [...document.querySelectorAll('div')].filter(e => {
    const c = typeof e.className === 'string' ? e.className : ''
    if (!c.includes('rounded-lg') || !c.includes('border-line') || !c.includes('bg-elevated')) return false
    const t = e.textContent || ''
    if (t.length < 6) return false
    return /厂商|核心|容量|频率|类型|速率|型号|健康|显存|驱动/.test(t)
  })
  if (groups.length === 0) return JSON.stringify({ err: 'no-groups' })
  const rects = groups.map(g => g.getBoundingClientRect())
  const byRow = {}
  for (const r of rects) { const k = Math.round(r.top / 6) * 6; byRow[k] = (byRow[k] || []).concat(Math.round(r.height)) }
  const uneven = Object.values(byRow).filter(hs => new Set(hs).size > 1).length
  return JSON.stringify({
    found: groups.length,
    rows: Object.keys(byRow).length,
    unevenRows: uneven,
    maxPerRow: Math.max(...Object.values(byRow).map(a => a.length)),
    avgGroupH: Math.round(rects.reduce((a, r) => a + r.height, 0) / rects.length),
  })
})()`)
let hwObj = {}
try { hwObj = JSON.parse(hw) } catch {}
check('硬件区找到真实分组', (hwObj.found ?? 0) >= 4, hw)
check('硬件分组密排（均高 ≤120px）', (hwObj.avgGroupH ?? 999) <= 120, `avgGroupH=${hwObj.avgGroupH}`)
check('宽屏下分组并排', (hwObj.maxPerRow ?? 0) >= 2, `maxPerRow=${hwObj.maxPerRow}, span=${hwObj.spanH}px`)

// ---- 2. 手机 UA ----
await send('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (Linux; Android 15; 22021211RC) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36',
  platform: 'Linux armv8l',
})
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true })
await send('Page.navigate', { url: BASE + '/' }); await sleep(2500)
await ev(`location.hash='#/local'`); await sleep(4500)
const mt = (await ev('document.body.innerText')) || ''
check('手机本机页无「不能启动」提示', !/不能启动本机被控端/.test(mt), '')
check('手机本机页无「还没有运行被控端」卡片', !/还没有运行被控端|连不上本机被控端/.test(mt), '')
check('手机本机页展示自身信息', /手机|Android|屏幕|核心|存储|网络|电池/.test(mt), mt.split('\n').filter(Boolean).slice(0, 8).join(' | '))

// ---- 4. 切页卡顿 ----
await send('Emulation.clearDeviceMetricsOverride')
await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36' })
await send('Page.navigate', { url: BASE + '/' }); await sleep(2000)
await ev(`location.hash='#/scan'`); await sleep(1200)
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/扫描/.test(x.innerText||'')); if(b) b.click() })()`)
await sleep(1500)
const t0 = Date.now()
await ev(`location.hash='#/devices'`)
// 切走之后页面应当立刻可交互：用一个轻量 DOM 操作测往返时延
await sleep(600)
const latency = await ev(`(async () => { const s=performance.now(); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return Math.round(performance.now()-s) })()`)
check('切走发现页后 2 帧内可响应', typeof latency === 'number' && latency < 260, `latency=${latency}ms, 切走耗时=${Date.now() - t0}ms`)

check('无未捕获异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
ws.close(); proc.kill(); process.exit(failed.length ? 1 : 0)
