import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = process.argv[2] || 'http://127.0.0.1:8420'
const pair = JSON.parse(readFileSync('.tmp/pair.json', 'utf8'))
const dev = {
  id: pair.server.id,
  host: new URL(BASE).hostname,
  port: Number(new URL(BASE).port || 8420),
  tls: false,
  token: pair.token,
  clientId: pair.clientId,
  name: pair.server.name,
  os: 'windows',
  arch: 'amd64',
  ver: '1.0.2',
  addedAt: Date.now(),
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

const proc = spawn(
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--remote-debugging-port=9360', '--disable-gpu', '--no-first-run',
   '--user-data-dir=' + process.cwd() + '/.tmp/edge-stats', 'about:blank'],
  { stdio: 'ignore' },
)
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:9360/json/list')).json()
    if (l.find((t) => t.type === 'page')) break
  } catch {}
  await sleep(250)
}
const list = await (await fetch('http://127.0.0.1:9360/json/list')).json()
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pend = new Map()
const errors = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
    // 扩展噪声（Edge 自带 / 装的翻译插件）来自 chrome-extension://，与应用无关
    if (/Receiving end does not exist|Could not establish connection|Immersive Translate|chrome-extension:\/\//.test(text)) return
    errors.push(text)
  }
}
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.value
await send('Page.enable'); await send('Runtime.enable')

// 轮询等待页面出现关键字：/stats 首次聚合要读事件日志，固定 sleep 在冷启动时会误判
async function waitForText(keyword, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const text = await ev('document.body.innerText')
    if (typeof text === 'string' && text.includes(keyword)) return text
    await sleep(500)
  }
  return (await ev('document.body.innerText')) || ''
}

async function open(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 })
  await send('Page.navigate', { url: BASE + '/' })
  await sleep(1500)
  await ev(`localStorage.setItem('landeck.app.v1', ${JSON.stringify(JSON.stringify({ state: { devices: [dev], activeId: dev.id, myName: 'YG', myId: 'web' }, version: 0 }))})`)
  await send('Page.navigate', { url: BASE + '/' })
  await sleep(2000)
}

// 1) 统计页
await open(1440, 1000)
await ev(`location.hash='#/stats'`)
const statsText = await waitForText('规模与活动')
check('统计页渲染主视觉与指标区', /已运行/.test(statsText) && /规模与活动/.test(statsText))
check('统计页有运行时长', /已运行/.test(statsText))
check('统计页有实时资源', /实时资源|CPU/.test(statsText))
check('统计页有磁盘占用', /磁盘占用/.test(statsText))
check('统计页有操作趋势', /操作趋势/.test(statsText))
check('统计页有操作分类', /操作分类/.test(statsText))
check('统计页有操作来源', /操作来源/.test(statsText))
const statNums = await ev(`(() => (document.body.innerText.match(/[0-9]+/g) || []).length)()`)
check('统计页有真实数字', statNums > 20, `数字个数=${statNums}`)

// 2) 手机上不应出现开机自启
await open(390, 844)
await ev(`location.hash='#/settings'`)
await sleep(3000)
const mobileSettings = await ev('document.body.innerText')
check('手机设置页无「开机自启」', !mobileSettings.includes('开机自启'), mobileSettings.includes('开机自启') ? '仍出现' : '已隐藏')
check('手机设置页无「从手机连上」描述', !/从手机连上|随时都能从手机/.test(mobileSettings))
check('手机设置页仍有外观选项', /外观/.test(mobileSettings))

// 3) 桌面浏览器（无 Tauri）也不该出现自启开关
await open(1440, 900)
await ev(`location.hash='#/settings'`)
await sleep(2500)
const webSettings = await ev('document.body.innerText')
check('浏览器设置页无「开机自启」', !webSettings.includes('开机自启'), webSettings.includes('开机自启') ? '仍出现' : '已隐藏')

// 4) 导航含统计
check('导航含「统计」', /统计/.test(await ev('document.body.innerText')))

// 5) 无 console 错误
check('无 console.error', errors.length === 0, errors.slice(0, 2).join(' | '))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
ws.close()
proc.kill()
process.exit(failed.length ? 1 : 0)
