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
  ['--headless=new', '--remote-debugging-port=9380', '--disable-gpu', '--no-first-run',
   '--user-data-dir=' + process.cwd() + '/.tmp/edge-local', 'about:blank'],
  { stdio: 'ignore' },
)
for (let i = 0; i < 80; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:9380/json/list')).json()
    if (l.find((t) => t.type === 'page')) break
  } catch {}
  await sleep(250)
}
const list = await (await fetch('http://127.0.0.1:9380/json/list')).json()
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pend = new Map()
const errs = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    errs.push((d.exception?.description || d.text).split('\n')[0])
  }
}
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); return r.result?.value ?? r.exceptionDetails?.text }
await send('Page.enable'); await send('Runtime.enable')

// 关键：localStorage 完全干净 —— 模拟「没有配对过任何设备」的全新用户
await send('Page.navigate', { url: BASE + '/' })
await sleep(2000)
await ev(`localStorage.clear()`)
await send('Page.navigate', { url: BASE + '/' })
await sleep(2500)

await ev(`location.hash='#/local'`)
await sleep(4500)
const text = await ev('document.body.innerText')

check('本机页可打开（无需配对）', /本机|当前机器/.test(text), text.split('\n').filter(Boolean).slice(0, 6).join(' | '))
check('本机页显示系统信息', /主机名|系统|内核/.test(text))
check('本机页显示实时资源', /实时资源|CPU/.test(text))
check('本机页不是空态', !/还没有已配对|先配对/.test(text))
check('本机页硬件有真数据', /AMD|Intel|DDR|内存条|NVMe|SSD|GHz|MHz|GB/.test(text), '')
check('硬件未报"空的硬件数据"', !/返回了空的硬件数据/.test(text))
const nums = await ev(`(document.body.innerText.match(/[0-9]+/g) || []).length`)
check('本机页有真实数字', nums > 30, `数字=${nums}`)

// 扫描不应包含本机
await ev(`location.hash='#/scan'`)
await sleep(2000)
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/扫描|重新扫描/.test(x.innerText||'')); if(b) b.click(); return !!b })()`)
await sleep(9000)
const scanText = await ev('document.body.innerText')
check('扫描结果不含「本机」条目', !/本机/.test(scanText) || !/直接进入/.test(scanText), '')
check('扫描页仍可用', /发现结果|扫描/.test(scanText))

check('无未捕获异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
ws.close(); proc.kill(); process.exit(failed.length ? 1 : 0)
