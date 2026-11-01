import { Minus, Monitor, Moon, Square, Sun } from 'lucide-react'
import { THEME_LABEL, useTheme } from '../../store/theme'
import { IconButton } from '../ui'

/**
 * 侧栏底部主题按钮：五主题循环（跟随系统 → 明亮 → 暗色 → 简约 → 留白扁平）。
 * tooltip / aria-label 都带上当前模式，键盘用户也能读到。
 */
const ICONS = { system: Monitor, light: Sun, dark: Moon, minimal: Minus, flat: Square } as const

export function ThemeToggle() {
  const { mode, cycle } = useTheme()
  const Icon = ICONS[mode as keyof typeof ICONS] ?? Sun
  const label = `主题：${THEME_LABEL[mode]}（点击切换）`

  return (
    <IconButton label={label} size="md" onClick={cycle} className="shrink-0">
      <Icon size={16} />
    </IconButton>
  )
}
