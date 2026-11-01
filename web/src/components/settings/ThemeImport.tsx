import { useRef, useState } from 'react'
import { Button, Input } from '../ui'
import { useApp } from '../../store/app'
import { useT } from '../../i18n'
import { importTheme, loadImportedThemes, removeImportedTheme, type ImportedTheme } from '../../store/theme'

/**
 * 十期 A3 主题包导入（外观卡内的小节，独立组件避免搅动 lead 的外观卡 JSX）。
 * 流程：文件选择（.json）→ FileReader → parseThemePackage 校验 → 注册 data-theme
 * + 持久化 localStorage('landeck.themes.v1')。导入后立即出现在主题选择器。
 */
export function ThemeImport({ onChanged }: { onChanged?: () => void }) {
  const t = useT('sync')
  const toast = useApp((s) => s.toast)
  const fileRef = useRef<HTMLInputElement>(null)
  const [imported, setImported] = useState<ImportedTheme[]>(() => loadImportedThemes())

  const pick = async (file: File) => {
    try {
      const text = await file.text()
      const theme = importTheme(text)
      setImported(loadImportedThemes())
      toast({ kind: 'ok', title: t('themeImported'), desc: theme.name })
      onChanged?.()
    } catch (e) {
      toast({ kind: 'error', title: t('themeImportFailed'), desc: String((e as Error).message || e) })
    }
  }

  return (
    <div className="mt-4 border-t border-line-soft pt-4">
      <div className="text-[13.5px] font-medium text-fg">{t('themeImportTitle')}</div>
      <p className="mt-0.5 text-[12px] text-muted">{t('themeImportDesc')}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void pick(f)
            e.target.value = '' // 允许重复选同一文件
          }}
        />
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          {t('themeImportBtn')}
        </Button>
        {imported.length > 0 && (
          <span className="text-[11.5px] text-faint">{t('themeImportedCount', { count: imported.length })}</span>
        )}
      </div>
      {imported.length > 0 && (
        <ul className="mt-2 space-y-1">
          {imported.map((th) => (
            <li key={th.id} className="flex items-center justify-between gap-2 text-[12px]">
              <span className="text-fg-soft">{th.name}</span>
              <button
                type="button"
                className="text-[11.5px] text-danger hover:underline"
                onClick={() => {
                  removeImportedTheme(th.id)
                  setImported(loadImportedThemes())
                  onChanged?.()
                }}
              >
                {t('themeRemove')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input type="hidden" />
    </div>
  )
}
