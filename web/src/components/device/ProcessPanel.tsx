import { useCallback, useState } from 'react'
import { Card, Segmented } from '../ui'
import { Layers, ListTree } from 'lucide-react'
import type { AgentClient } from '../../lib/api'
import type { SystemInfo } from '../../lib/types'
import { AppPanel } from './AppPanel'
import { ProcessListPanel } from './ProcessListPanel'

type Tab = 'app' | 'proc'

/** 记住上次选的 Tab：下次进详情页直接落在用户习惯的视图 */
const TAB_KEY = 'landeck.proc.tab'

function readTab(): Tab {
  try {
    const v = window.localStorage.getItem(TAB_KEY)
    if (v === 'app' || v === 'proc') return v
  } catch {
    /* 隐私模式下 localStorage 可能不可用，退回默认 */
  }
  return 'app'
}

function saveTab(tab: Tab) {
  try {
    window.localStorage.setItem(TAB_KEY, tab)
  } catch {
    /* 忽略写入失败 */
  }
}

const TABS: { value: Tab; label: string; icon: React.ReactNode }[] = [
  { value: 'app', label: '应用', icon: <Layers size={13} /> },
  { value: 'proc', label: '进程', icon: <ListTree size={13} /> },
]

/**
 * 进程面板：默认按「应用」展示（用户只认应用），第二个 Tab 保留原始进程列表。
 * 两个视图各自管自己的轮询，切走即卸载，不会重复拉数据。
 */
export function ProcessPanel({
  client,
  system,
  onAuthError,
}: {
  client: AgentClient | null
  system: SystemInfo | null
  onAuthError?: () => void
}) {
  const [tab, setTabState] = useState<Tab>(readTab)
  const setTab = useCallback((next: Tab) => {
    setTabState(next)
    saveTab(next)
  }, [])

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-fg">应用与进程</h3>
          <p className="mt-0.5 text-[12px] text-muted">
            {tab === 'app'
              ? '按应用汇总：同名进程合并成一行，可直接结束整个应用'
              : '原始进程列表：按 PID 逐个查看，适合排查细节'}
          </p>
        </div>
        <Segmented value={tab} onChange={setTab} options={TABS} size="sm" />
      </div>

      <div className="mt-3.5 border-t border-line-soft pt-3.5">
        {tab === 'app' ? (
          <AppPanel client={client} system={system} onAuthError={onAuthError} embedded />
        ) : (
          <ProcessListPanel client={client} system={system} onAuthError={onAuthError} embedded />
        )}
      </div>
    </Card>
  )
}
