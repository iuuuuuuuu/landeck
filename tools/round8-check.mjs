// 本轮 8 条反馈的实测（真浏览器 + 真 Agent）
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
  ['--headless=new', '--remote-debugging-port=9399', '--disable-gpu', '--no-first-run',
   '--user-data-dir=' + process.cwd() + '/.tmp/edge-r8', 'about:blank'],
  { stdio: 'ignore' },
)
for (let i = 0; i < 80; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:9399/json/list')).json()
    if (l.find((t) => t.type === 'page')) break
  } catch {}
  await sleep(250)
}
const list = await (await fetch('http://127.0.0.1:9399/json/list')).json()
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
    if (/Receiving end does not exist|Could not establish connection/.test(t)) return
    errs.push(t)
  }
}
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); return r.result?.value ?? r.exceptionDetails?.text }
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BASE + '/' }); await sleep(2000)
await ev(`localStorage.clear()`)
await send('Page.navigate', { url: BASE + '/' }); await sleep(2800)

// ---- 7/8. 导航不再有文件/定时；旧路由重定向 ----
const navText = await ev(`document.body.innerText`)
check('导航已移除「文件」', !/^\s*文件\s*$/m.test(navText.split('设置')[0]), '')
check('导航已移除「定时」', !/^\s*定时\s*$/m.test(navText.split('设置')[0]), '')
await ev(`location.hash='#/files'`); await sleep(1500)
check('/files 重定向到 /devices', (await ev(`location.hash`)) === '#/devices', await ev(`location.hash`))
await ev(`location.hash='#/schedules'`); await sleep(1500)
check('/schedules 重定向到 /devices', (await ev(`location.hash`)) === '#/devices', await ev(`location.hash`))

// ---- 4/6. 硬件卡片等高 + 可滚动 ----
await ev(`location.hash='#/local'`); await sleep(5000)
const hw = await ev(`(() => {
  const h=[...document.querySelectorAll('h3')].find(x=>/硬件信息/.test(x.textContent||''))
  if(!h) return JSON.stringify({err:'no-title'})
  let card=h; for(let i=0;i<3;i++){ if(card.parentElement) card=card.parentElement }
  let best=null
  for (const g of card.querySelectorAll('div')) {
    const c = typeof g.className==='string'?g.className:''
    if (!c.includes('grid')) continue
    const kids=[...g.children].filter(k=>{
      const kc=typeof k.className==='string'?k.className:''
      return kc.includes('rounded-')&&kc.includes('border-line')
    })
    if (kids.length>0 && (!best||kids.length>best.kids.length)) best={g,kids}
  }
  if(!best) return JSON.stringify({err:'no-groups'})
  const rects=best.kids.map(k=>k.getBoundingClientRect())
  const byRow={}
  for(const r of rects){const k=Math.round(r.top/4)*4; (byRow[k]=byRow[k]||[]).push(Math.round(r.height))}
  const rowHeights = Object.values(byRow).map(hs=>new Set(hs).size)
  const scrollEl = card.querySelector('.overflow-y-auto, [class*="overflow-y"]')
  return JSON.stringify({
    groups: best.kids.length,
    rows: Object.keys(byRow).length,
    unevenRows: rowHeights.filter(n=>n>1).length,
    hasScrollBox: !!scrollEl,
    scrollH: scrollEl?scrollEl.scrollHeight:0,
    clientH: scrollEl?scrollEl.clientHeight:0,
  })
})()`)
let hwObj = {}
try { hwObj = JSON.parse(hw) } catch {}
check('硬件区找到分组', (hwObj.groups ?? 0) >= 4, hw)
check('同行卡片等高', (hwObj.unevenRows ?? 9) === 0, `不等高的行数=${hwObj.unevenRows}, 总行=${hwObj.rows}`)

const wheel = await ev(`(async () => {
  const el = [...document.querySelectorAll('[class*="overflow-y"]')].find(e=>/处理器|内存|显卡/.test(e.textContent||''))
  if(!el) return 'no-scroll-el'
  const before = el.scrollTop
  el.scrollTop = 200
  const after = el.scrollTop
  el.scrollTop = before
  return JSON.stringify({canScroll: after>before || el.scrollHeight<=el.clientHeight, scrollH: el.scrollHeight, clientH: el.clientHeight})
})()`)
let wObj = {}
try { wObj = JSON.parse(wheel) } catch {}
check('硬件区滚动可用（内容超出时可滚 / 不超出时无残留）', wObj.canScroll === true, wheel)

// ---- 5. 开机统计按月 ----
await ev(`location.hash='#/devices'`); await sleep(1200)
await ev(`location.hash='#/local'`); await sleep(4000)
const upText = await ev(`document.body.innerText`)
check('开机统计显示按月', /月/.test(upText) && /近 12 个月/.test(upText), upText.split('\n').filter(l=>/开机统计|个月|月/.test(l)).slice(0,3).join(' | '))

// ---- 3. 手机信息 ----
await send('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-G991B Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36',
  platform: 'Linux armv8l',
})
await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 873, deviceScaleFactor: 2.75, mobile: true })
await send('Page.navigate', { url: BASE + '/' }); await sleep(2500)
await ev(`location.hash='#/local'`); await sleep(4500)
const mt = await ev(`document.body.innerText`)
check('手机型号从 UA 正确解析', /SM-G991B/.test(mt), mt.split('\n').filter(l=>/SM-G991B|Android/.test(l)).slice(0,2).join(' | '))
check('手机不再出现伪造 0/空', !/内存\s*0|存储\s*0\s*\/\s*0/.test(mt), '')
check('不支持的项目明确标注', /不支持读取|未提供|不可用|≈/.test(mt), mt.split('\n').filter(l=>/不支持|未提供|≈/.test(l)).slice(0,2).join(' | '))
check('区分逻辑分辨率与物理像素', /逻辑|物理/.test(mt), '')

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (errs.length) console.log('异常:', errs.slice(0, 3).join(' | '))
ws.close(); proc.kill(); process.exit(failed.length ? 1 : 0)
