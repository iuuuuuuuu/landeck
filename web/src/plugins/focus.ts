/**
 * Focus 番茄钟——首个内置插件（bundled，十期 A4）。
 *
 * 25/5 计时器：开始/暂停/重置；完成 toast；可选显示「本时段活动用时」
 * （ctx.activity.query 当日 summary——演示插件 API 面）。
 *
 * 实现为统一契约的 entry 模块（activate(ctx) → {el, dispose}），vanilla DOM——
 * 与未来从 agent dataDir 动态装载的第三方插件走同一条装载链，自带测试样本价值。
 */

import type { PluginContext, PluginManifest, PluginModule } from './types'

const FOCUS_SEC = 25 * 60
const BREAK_SEC = 5 * 60

export const focusPlugin: { manifest: PluginManifest } & PluginModule = {
  manifest: {
    id: 'focus',
    name: 'Focus 番茄钟',
    version: '1.0.0',
    entry: 'bundled://focus',
    permissions: ['activity.read'],
    author: 'LanDeck',
  },

  async activate(ctx: PluginContext) {
    const root = document.createElement('div')
    root.className = 'flex flex-col gap-3'

    // 状态：focus | break；剩余秒数从时间戳推（_interval 被后台节流也走时不漂）
    let mode: 'focus' | 'break' = 'focus'
    let running = false
    let endAt = 0
    let remainSec = FOCUS_SEC
    let timer: number | null = null
    let showUsage = false

    root.innerHTML = `
      <div class="rounded-2xl border border-line-soft bg-elevated p-5">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-[12px] uppercase tracking-[0.12em] text-faint" data-role="mode">专注</div>
            <div class="num text-[44px] font-semibold leading-none text-fg mt-2" data-role="clock">25:00</div>
          </div>
          <div class="text-right">
            <div class="text-[11px] text-faint" data-role="usage-label"></div>
            <div class="num text-[13px] text-fg-soft" data-role="usage"></div>
          </div>
        </div>
        <div class="mt-4 flex items-center gap-2">
          <button type="button" data-role="toggle" class="h-9 rounded-xl bg-accent px-5 text-[13px] font-medium text-white">开始</button>
          <button type="button" data-role="reset" class="h-9 rounded-xl border border-line-soft px-4 text-[13px] text-muted hover:text-fg-soft">重置</button>
          <label class="ml-auto flex items-center gap-1.5 text-[11.5px] text-muted">
            <input type="checkbox" data-role="usage-toggle" class="h-3.5 w-3.5 accent-[var(--tone-accent)]" />
            本时段活动用时
          </label>
        </div>
      </div>
    `
    const $ = (role: string) => root.querySelector(`[data-role="${role}"]`) as HTMLElement
    const clockEl = $('clock')
    const modeEl = $('mode')
    const toggleBtn = $('toggle') as HTMLButtonElement
    const usageEl = $('usage')
    const usageLabel = $('usage-label')

    const fmt = (sec: number) =>
      `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.max(0, sec % 60)).padStart(2, '0')}`

    const render = () => {
      clockEl.textContent = fmt(remainSec)
      modeEl.textContent = mode === 'focus' ? '专注' : '休息'
      toggleBtn.textContent = running ? '暂停' : '开始'
    }

    async function refreshUsage() {
      if (!showUsage) return
      usageLabel.textContent = '今日已记录活动'
      usageEl.textContent = '…'
      try {
        const today = new Date()
        const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
        const r = await ctx.activity.query({ scope: 'day', date })
        const min = Math.round(r.totalSec / 60)
        usageEl.textContent = min >= 60 ? `${Math.floor(min / 60)} 小时 ${min % 60} 分` : `${min} 分钟`
      } catch (e) {
        usageEl.textContent = '不可用'
        void e
      }
    }

    const tick = () => {
      remainSec = Math.max(0, Math.round((endAt - Date.now()) / 1000))
      if (remainSec === 0) {
        stop()
        if (mode === 'focus') {
          ctx.ui.toast('专注完成，休息 5 分钟')
          mode = 'break'
          remainSec = BREAK_SEC
        } else {
          ctx.ui.toast('休息结束，开始下一轮专注')
          mode = 'focus'
          remainSec = FOCUS_SEC
        }
        void refreshUsage()
      }
      render()
    }

    const startInterval = () => {
      if (timer !== null) clearInterval(timer)
      timer = window.setInterval(tick, 250)
    }
    const stop = () => {
      running = false
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }

    toggleBtn.addEventListener('click', () => {
      if (running) {
        // 暂停：记住剩余
        remainSec = Math.max(0, Math.round((endAt - Date.now()) / 1000))
        stop()
      } else {
        running = true
        endAt = Date.now() + remainSec * 1000
        startInterval()
        void refreshUsage()
      }
      render()
    })
    ;($('reset') as HTMLButtonElement).addEventListener('click', () => {
      stop()
      mode = 'focus'
      remainSec = FOCUS_SEC
      render()
    })
    ;($('usage-toggle') as HTMLInputElement).addEventListener('change', (e) => {
      showUsage = (e.target as HTMLInputElement).checked
      if (showUsage) void refreshUsage()
      else {
        usageLabel.textContent = ''
        usageEl.textContent = ''
      }
    })

    render()
    return {
      el: root,
      dispose() {
        stop()
      },
    }
  },
}
