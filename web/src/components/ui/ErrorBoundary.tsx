import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button, Card } from '../ui'

/**
 * 局部错误边界。
 *
 * 之前一个卡片里的 `undefined.enabled` 就能把整个应用打成白屏 ——
 * 用户看到的是「一片空白」，连导航都没了，完全无从判断哪里坏了。
 * 现在把每个页面包一层：崩了只替换这一块，其余照常可用，并给出可复制的错误信息。
 */
interface Props {
  children: ReactNode
  /** 出错时的标题，默认「这一块加载失败」 */
  title?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 控制台留全栈，方便用户截图反馈
    console.error('[LanDeck] 组件渲染失败:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <Card>
        <div className="flex items-start gap-2.5">
          <TriangleAlert size={17} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold text-fg">{this.props.title ?? '这一块加载失败'}</h3>
            <p className="mt-1 break-words text-[12px] leading-relaxed text-muted">
              {error.message || String(error)}
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => this.setState({ error: null })}>
                重试
              </Button>
              <Button size="sm" variant="ghost" onClick={() => location.reload()}>
                刷新页面
              </Button>
            </div>
          </div>
        </div>
      </Card>
    )
  }
}
