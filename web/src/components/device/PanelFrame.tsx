import type { ReactNode } from 'react'
import { Card } from '../ui'

/**
 * 面板外框：独立使用时是 Card，被 Tab 容器嵌入时退化成普通块，
 * 避免出现「卡片套卡片」的双层描边。
 */
export function PanelFrame({
  embedded,
  children,
}: {
  embedded?: boolean
  children: ReactNode
}) {
  if (embedded) return <div className="pt-0.5">{children}</div>
  return <Card>{children}</Card>
}
