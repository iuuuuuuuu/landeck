import { Monitor, Moon, Sun } from 'lucide-react'
import { THEME_LABEL, useTheme } from '../../store/theme'
import { IconButton } from '../ui'

/**
 * 顶栏主题按钮：跟随系统 → 深色 → 浅色 三态循环。
 * tooltip / aria-label 都带上当前模式，键盘用户也能读到。
 */
export function ThemeToggle() {
  const { mode, cycle } = useTheme()
  const Icon = mode === 'system' ? Monitor : mode === 'dark' ? Moon : Sun
  const label = `主题：${THEME_LABEL[mode]}（点击切换）`

  return (
    <IconButton label={label} size="md" onClick={cycle} className="shrink-0">
      <Icon size={16} />
    </IconButton>
  )
}
