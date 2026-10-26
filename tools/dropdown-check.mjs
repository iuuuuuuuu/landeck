// 自绘下拉框的实测：能打开、能选中、键盘可用、不出现原生 select
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = process.argv[2] || 'http://10.168.1.115:8420'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

const proc = spawn(
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--remote-debugging-port=9420', '--disable-gpu', '--no-first-run',
   '--user-data-dir=' + process.cwd() + '/.tmp/edge-sel', 'about:blank'],
  { stdio: 'ignore' },
)
for (let i = 0; i < 80; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:9420/json/list')).json()
    if (l.find((t) => t.type === 'page')) break
  } catch {}
  await sleep(250)
}
const list = await (await fetch('http://127.0.0.1:9420/json/list')).json()
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pend = new Map()
const errs = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') {
    const t = (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').split('\n')[0]
    if (/Receiving end does not exist|Could not establish connection|Immersive Translate|chrome-extension/.test(t)) return
    errs.push(t)
  }
}
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); return r.result?.value ?? r.exceptionDetails?.text }
await send('Page.enable'); await send('Runtime.enable')

/** 轮询等待条件成立（弹层有退出动画，固定 sleep 会偶发误判） */
async function waitUntil(expr, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await ev(expr)) return true
    await sleep(60)
  }
  return false
}
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BASE + '/' }); await sleep(2200)
await ev(`localStorage.clear()`)
await send('Page.navigate', { url: BASE + '/' }); await sleep(3000)

// 用「本机」进详情页（无需配对），里面有定时任务/文件入口
await ev(`location.hash='#/stats'`); await sleep(5000)

// 1. 页面上不应再有原生 select 元素（除了隐藏在代码里的）
const nativeCount = await ev(`document.querySelectorAll('select').length`)
check('页面不再渲染原生 <select>', nativeCount === 0, `原生 select 数量=${nativeCount}`)

// 2. 找到 combobox 按钮并打开
const combobox = await ev(`(() => {
  const b = [...document.querySelectorAll('[role="combobox"]')]
  if (!b.length) return JSON.stringify({found:0})
  const first = b[0]
  first.scrollIntoView({block:'center'})
  return JSON.stringify({found:b.length, label: first.getAttribute('aria-label') || '', text: (first.innerText||'').slice(0,30)})
})()`)
let cbObj = {}
try { cbObj = JSON.parse(combobox) } catch {}
check('存在自绘下拉（role=combobox）', (cbObj.found ?? 0) > 0, combobox)

if ((cbObj.found ?? 0) > 0) {
  await ev(`document.querySelectorAll('[role="combobox"]')[0].click()`)
  await sleep(500)
  const opened = await ev(`(() => {
    const lb = document.querySelector('[role="listbox"]')
    if (!lb) return JSON.stringify({open:false})
    const opts = [...lb.querySelectorAll('[role="option"]')]
    return JSON.stringify({open:true, options: opts.length, first: (opts[0]?.innerText||'').slice(0,24), hasCheck: !!lb.querySelector('svg')})
  })()`)
  let oObj = {}
  try { oObj = JSON.parse(opened) } catch {}
  check('点击后弹出 listbox', oObj.open === true, opened)
  check('弹层有选项', (oObj.options ?? 0) > 0, `选项数=${oObj.options}, 首个=${oObj.first}`)

  // Esc 关闭
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(400)
  const closedByEsc = await waitUntil(`!document.querySelector('[role="listbox"]')`)
  check('Esc 可关闭弹层', closedByEsc === true, '')

  // 键盘：Enter 打开 + 方向键 + Enter 选中
  await ev(`document.querySelectorAll('[role="combobox"]')[0].focus()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await sleep(400)
  const kbOpen = await ev(`!!document.querySelector('[role="listbox"]')`)
  check('键盘 Enter 可打开', kbOpen === true, '')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
  await sleep(250)
  const hasActive = await ev(`(() => {
    const lb = document.querySelector('[role="listbox"]')
    if (!lb) return false
    // 高亮项通过背景色区分，这里检查 aria-selected 或样式类是否变化
    return [...lb.querySelectorAll('[role="option"]')].some(o => (o.className||'').includes('bg-elevated-2'))
  })()`)
  check('方向键能移动高亮项', hasActive === true, '')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await sleep(400)
  const afterPick = await waitUntil(`!document.querySelector('[role="listbox"]')`)
  check('Enter 选中后关闭', afterPick === true, '')

  // 点外部关闭
  await ev(`document.querySelectorAll('[role="combobox"]')[0].click()`)
  await sleep(350)
  await ev(`document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)
  await sleep(350)
  const outsideClosed = await waitUntil(`!document.querySelector('[role="listbox"]')`)
  check('点击外部关闭', outsideClosed === true, '')
}

check('无未捕获异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
ws.close(); proc.kill(); process.exit(failed.length ? 1 : 0)
