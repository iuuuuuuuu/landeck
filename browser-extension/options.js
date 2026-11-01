/** Options 页：agent 地址 / token / 启用开关 / www 剥离 / 连接测试 */
const DEFAULTS = {
  agentUrl: 'http://127.0.0.1:8420',
  token: '',
  enabled: false,
  stripWww: true,
}

const $ = (id) => document.getElementById(id)

async function load() {
  const s = await chrome.storage.local.get(DEFAULTS)
  $('agentUrl').value = s.agentUrl
  $('token').value = s.token
  $('enabled').checked = s.enabled === true
  $('stripWww').checked = s.stripWww !== false
}

function flash(text, ok) {
  const el = $('msg')
  el.textContent = text
  el.className = ok ? 'ok' : 'err'
}

async function save() {
  const agentUrl = $('agentUrl').value.trim().replace(/\/+$/, '') || DEFAULTS.agentUrl
  await chrome.storage.local.set({
    agentUrl,
    token: $('token').value.trim(),
    enabled: $('enabled').checked,
    stripWww: $('stripWww').checked,
  })
  flash('已保存', true)
}

async function testConnection() {
  const base = $('agentUrl').value.trim().replace(/\/+$/, '') || DEFAULTS.agentUrl
  flash('测试中…', true)
  try {
    const resp = await fetch(`${base}/api/v1/hello`, { cache: 'no-store' })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const info = await resp.json()
    flash(`连接成功：${info.name || 'agent'}（v${info.ver || '?'}）`, true)
  } catch (e) {
    flash(`连接失败：${e.message}——确认桌面端在运行、地址正确`, false)
  }
}

$('save').addEventListener('click', () => void save())
$('test').addEventListener('click', () => void testConnection())
void load()
