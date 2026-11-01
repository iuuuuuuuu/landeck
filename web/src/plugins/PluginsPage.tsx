import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Puzzle, RefreshCw, Trash2 } from 'lucide-react'
import { Card, SectionTitle } from '../components/ui'
import { PageHeader } from '../components/shell/PageHeader'
import { useApp } from '../store/app'
import { useT } from '../i18n'
import {
  bundledRecords,
  createContext,
  importManifest,
  listInstalled,
  loadModule,
  removeInstalled,
  type HostEnv,
} from './host'
import { fetchCatalog, DEFAULT_CATALOG_URL } from './market'
import type { CatalogEntry, PluginRecord } from './types'

/**
 * 插件页（十期 A4）：已装插件列表 + Focus 面板 + 市场（占位目录）。
 * v1 安装 = 浏览器导入（manifest 粘贴）；agent /plugins/install 端点后续批次。
 */
export default function PluginsPage() {
  const t = useT('plugins')
  const tn = useT('nav')
  const devices = useApp((s) => s.devices)
  const activeId = useApp((s) => s.activeId)
  const device = useMemo(() => devices.find((d) => d.id === activeId) ?? null, [devices, activeId])
  const toast = useApp((s) => s.toast)

  const [installed, setInstalled] = useState<PluginRecord[]>(() => [...bundledRecords(), ...listInstalled()])
  const refreshInstalled = useCallback(() => {
    setInstalled([...bundledRecords(), ...listInstalled()])
  }, [])

  // Focus 面板挂载（走真实装载链：loadModule → activate(ctx)）
  const focusHostRef = useRef<HTMLDivElement>(null)
  const disposeRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    const host = focusHostRef.current
    if (!host || !device) return
    let cancelled = false
    const rec = bundledRecords()[0]
    const env: HostEnv = {
      target: { host: device.host, port: device.port, tls: device.tls, ...(device.local ? { local: true } : {}) },
      token: device.token,
      toast: (msg) => toast({ kind: 'info', title: msg }),
    }
    void (async () => {
      const mod = await loadModule(rec, undefined)
      if (cancelled) return
      const ctx = createContext(rec.manifest, env)
      const inst = await mod.activate(ctx)
      if (cancelled) {
        inst.dispose?.()
        return
      }
      host.innerHTML = ''
      host.appendChild(inst.el)
      disposeRef.current = inst.dispose ?? null
    })()
    return () => {
      cancelled = true
      disposeRef.current?.()
      disposeRef.current = null
      host.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.id])

  // 市场
  const [catalog, setCatalog] = useState<{ entries: CatalogEntry[]; error: string | null }>({ entries: [], error: null })
  const [catalogLoading, setCatalogLoading] = useState(false)
  const refreshCatalog = useCallback(async () => {
    setCatalogLoading(true)
    setCatalog(await fetchCatalog())
    setCatalogLoading(false)
  }, [])
  useEffect(() => {
    void refreshCatalog()
  }, [refreshCatalog])

  // 导入（浏览器导入 v1）
  const [importDraft, setImportDraft] = useState('')
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const doImport = () => {
    const r = importManifest(importDraft)
    if (r.ok) {
      setImportMsg({ ok: true, text: t('importedOk', { name: r.record.manifest.name, ver: r.record.manifest.version }) })
      setImportDraft('')
      refreshInstalled()
    } else {
      setImportMsg({ ok: false, text: r.error })
    }
  }

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 pb-10 lg:px-8">
      <PageHeader title={tn('items.plugins')} sub={t('pageSub')} />

      {/* 已安装 */}
      <Card className="mt-5 p-4">
        <SectionTitle icon={<Puzzle size={16} />} title={t('installed')} />
        <div className="mt-3 space-y-2">
          {installed.map((rec) => (
            <div key={rec.manifest.id} className="flex items-center gap-3 rounded-xl border border-line-soft px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium text-fg">{rec.manifest.name}</span>
                  <span className="num text-[11px] text-faint">v{rec.manifest.version}</span>
                  {rec.source === 'bundled' ? (
                    <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">{t('builtin')}</span>
                  ) : (
                    <span className="rounded-md bg-warn/12 px-1.5 py-0.5 text-[10px] text-warn">{t('notDeployed')}</span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[11.5px] text-muted">
                  {rec.manifest.author} · {rec.manifest.permissions.join(', ')}
                </div>
              </div>
              {rec.source === 'import' && (
                <button
                  type="button"
                  aria-label={`${t('remove')} ${rec.manifest.name}`}
                  onClick={() => {
                    removeInstalled(rec.manifest.id)
                    refreshInstalled()
                  }}
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Focus 面板（内置插件走完整装载链） */}
      <Card className="mt-4 p-4">
        <SectionTitle icon={<Puzzle size={16} />} title={t('focusPanel')} />
        <div ref={focusHostRef} className="mt-3" />
      </Card>

      {/* 市场（占位目录） */}
      <Card className="mt-4 p-4">
        <div className="flex items-center justify-between">
          <SectionTitle icon={<Download size={16} />} title={t('market')} />
          <button
            type="button"
            onClick={() => void refreshCatalog()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-soft px-2.5 text-[12px] text-muted hover:text-fg-soft"
          >
            <RefreshCw size={13} className={catalogLoading ? 'animate-spin' : ''} />
            {t('refresh')}
          </button>
        </div>
        <div className="mt-1 text-[11px] text-faint">{DEFAULT_CATALOG_URL}</div>
        {catalog.error && <div className="mt-2 text-[12px] text-danger">{t('catalogError')} {catalog.error}</div>}
        <div className="mt-3 space-y-2">
          {catalog.entries.map((e) => (
            <div key={e.id} className="flex items-center gap-3 rounded-xl border border-line-soft px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium text-fg">{e.name}</span>
                  <span className="num text-[11px] text-faint">v{e.version}</span>
                  {e.bundled && <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">{t('builtin')}</span>}
                </div>
                <div className="mt-0.5 truncate text-[11.5px] text-muted">
                  {e.description || e.author} · {e.author}
                </div>
              </div>
              {e.bundled ? (
                <span className="text-[11px] text-faint">{t('alreadyBuiltin')}</span>
              ) : (
                <button
                  type="button"
                  disabled
                  title={t('installDisabledHint')}
                  className="h-8 cursor-not-allowed rounded-lg border border-line-soft px-3 text-[12px] text-faint"
                >
                  {t('install')}
                </button>
              )}
            </div>
          ))}
          {catalog.entries.length === 0 && !catalog.error && (
            <div className="rounded-xl border border-dashed border-line-soft px-3 py-6 text-center text-[12.5px] text-faint">
              {t('marketEmpty')}
            </div>
          )}
        </div>
        <div className="mt-3 rounded-xl border border-line-soft bg-elevated p-3">
          <div className="text-[12px] font-medium text-fg-soft">{t('importTitle')}</div>
          <textarea
            value={importDraft}
            onChange={(e) => setImportDraft(e.target.value)}
            placeholder='{"id":"my-plugin","name":"…","version":"1.0.0","entry":"plugins/my-plugin/entry.js","permissions":["activity.read"],"author":"…"}'
            rows={4}
            className="mt-2 w-full rounded-xl border border-line-soft bg-surface px-3 py-2 font-mono text-[11.5px] text-fg outline-none focus:border-accent"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={doImport}
              disabled={!importDraft.trim()}
              className="h-8 rounded-lg bg-accent px-4 text-[12px] font-medium text-white disabled:opacity-50"
            >
              {t('import')}
            </button>
            {importMsg && (
              <span className={importMsg.ok ? 'text-[12px] text-ok' : 'text-[12px] text-danger'}>{importMsg.text}</span>
            )}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">{t('importHint')}</p>
        </div>
      </Card>
    </div>
  )
}
