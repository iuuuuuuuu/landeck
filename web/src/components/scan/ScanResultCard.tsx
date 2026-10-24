import { ArrowRight } from 'lucide-react'
import { osLabel } from '../../lib/format'
import type { NodeInfo } from '../../lib/types'
import { Badge, Button, Card, DeviceAvatar } from '../ui'

/** 扫描结果单行：设备信息 + 配对状态 + 主操作 */
export function ScanResultCard({
  node,
  paired,
  onPair,
  onEnter,
}: {
  node: NodeInfo
  paired: boolean
  onPair: () => void
  onEnter: () => void
}) {
  return (
    <Card
      padded={false}
      className="flex items-center gap-3 p-3.5 transition-colors duration-150 hover:border-line-strong"
    >
      <DeviceAvatar os={node.os} size={42} online={paired ? true : undefined} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14px] font-medium text-fg">{node.name}</span>
          {node.self ? (
            <Badge tone="cyan" dot className="shrink-0">
              本机
            </Badge>
          ) : (
            <Badge tone={paired ? 'ok' : 'neutral'} dot className="shrink-0">
              {paired ? '已配对' : '未配对'}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted">
          <span className="num">
            {node.ip}:{node.port}
          </span>
          <span className="text-faint">·</span>
          <span>{osLabel(node.os)}</span>
          <span className="text-faint">·</span>
          <span className="num">Agent {node.ver}</span>
          {node.tls && (
            <>
              <span className="text-faint">·</span>
              <span className="text-cyan">TLS</span>
            </>
          )}
        </div>
      </div>
      <Button
        variant={paired || node.self ? 'secondary' : 'primary'}
        size="md"
        className="shrink-0"
        icon={<ArrowRight size={15} />}
        onClick={paired || node.self ? onEnter : onPair}
      >
        {node.self ? '直接进入' : paired ? '进入' : '配对'}
      </Button>
    </Card>
  )
}
