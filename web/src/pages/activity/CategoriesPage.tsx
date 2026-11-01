import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, SectionTitle, Select, Skeleton } from '../../components/ui'
import { useAsync } from '../../lib/hooks'
import { useT } from '../../i18n'
import { activityCategoriesKey, activityRankKey } from '../../lib/activityKeys'
import { fetchCategories, fetchRank, putCategories } from '../../lib/activityApi'
import type { CategoriesData } from '../../lib/activityApi'
import { AppIcon, CategoryIcon } from '../../components/activity/bits'
import { CollectionSettingsCard } from '../../components/activity/CollectionSettingsCard'
import { DataManageCard } from '../../components/activity/DataManageCard'
import { ActivityPageHeader, LoadError, NoDeviceGuide, useActivityTarget, useToast } from './shared'

/**
 * 分类管理 /activity/categories
 * 左：类别列表（改名 / 新增自建 / 删除自建）；右：应用 → 类别映射编辑。
 * 保存走 PUT /activity/categories；demo 模式只落本地状态并提示（agent 未上线）。
 */
export default function ActivityCategoriesPage() {
  const t = useT('categories')
  const { device, pairedCount, localAvailable } = useActivityTarget()
  const toast = useToast()

  const q = useAsync(() => fetchCategories(device, device.token), [device.host, device.port, device.token], {
    key: activityCategoriesKey(device),
    ttlMs: 3 * 60_000,
  })
  // 应用候选：排行里的应用 + 规则里已有的，合并去重
  const rank = useAsync(() => fetchRank(device, device.token, { scope: 'month', date: monthNow() }), [device.host, device.port, device.token], {
    key: activityRankKey(device, 'month', monthNow()),
    ttlMs: 3 * 60_000,
  })

  const [data, setData] = useState<CategoriesData | null>(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  useEffect(() => {
    if (q.data?.data) setData(structuredClone(q.data.data))
  }, [q.data])

  const apps = useMemo(() => {
    if (!data) return []
    const set = new Set<string>([...Object.keys(data.rules), ...(rank.data?.data.apps.map((a) => a.app.toLowerCase()) ?? [])])
    return [...set]
  }, [data, rank.data])

  if (!localAvailable && pairedCount === 0) return <NoDeviceGuide />
  if (q.error)
    return (
      <div className="space-y-4">
        <ActivityPageHeader title={t('title')} subtitle="应用与网站的活动分类" />
        <LoadError error={q.error} onRetry={q.reload} />
      </div>
    )

  const demo = !!q.data?.demo

  /** 保存（demo 不发请求）。所有编辑动作都汇到这里，保证只有一条保存路径。 */
  async function save(next: CategoriesData, okTitle: string) {
    setData(next)
    setSaving(true)
    try {
      const res = await putCategories(device, device.token, next)
      toast({ kind: 'ok', title: okTitle, desc: res.demo ? t('toast.demoDesc') : undefined })
    } catch (e) {
      toast({ kind: 'error', title: t('toast.saveFailed'), desc: String(e) })
    } finally {
      setSaving(false)
    }
  }

  function renameCat(key: string, label: string) {
    if (!data || !label.trim()) return
    save({ ...data, cats: data.cats.map((c) => (c.key === key ? { ...c, label: label.trim() } : c)) }, t('toast.renamed'))
  }

  function addCat() {
    if (!data || !newLabel.trim()) return
    const key = `custom-${Date.now().toString(36)}`
    save({ ...data, cats: [...data.cats, { key, label: newLabel.trim(), builtin: false }] }, t('toast.added'))
    setNewLabel('')
  }

  function removeCat(key: string) {
    if (!data) return
    const rules = { ...data.rules }
    for (const [app, cat] of Object.entries(rules)) {
      if (cat === key) delete rules[app]
    }
    save({ ...data, cats: data.cats.filter((c) => c.key !== key), rules }, t('toast.deleted'))
  }

  function setRule(app: string, cat: string) {
    if (!data) return
    const rules = { ...data.rules }
    if (cat) rules[app] = cat
    else delete rules[app]
    save({ ...data, rules }, t('toast.mappingUpdated'))
  }

  function countOf(key: string): number {
    return data ? Object.values(data.rules).filter((c) => c === key).length : 0
  }

  const filteredApps = apps.filter((a) => (search ? a.includes(search.toLowerCase()) : true))

  return (
    <div className="space-y-4">
      <ActivityPageHeader
        title="分类管理"
        subtitle={demo ? '演示数据：agent 活动接口上线后自动切真数据' : '给应用归类，统计页的图表和排行都按这里来'}
        demo={demo}
      />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[320px_1fr]">
        {/* 类别列表 */}
        <Card className="min-w-0 overflow-hidden">
          <SectionTitle title={t('cats.title')} desc={t('cats.desc')} />
          {!data ? (
            <Skeleton className="mb-2 h-64 w-full" />
          ) : (
            <>
              <ul className="mt-2 space-y-1">
                {data.cats.map((c) => (
                  <li key={c.key} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-elevated/60">
                    <CategoryIcon cat={c.key} size={15} />
                    {renaming === c.key ? (
                      <Input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => {
                          renameCat(c.key, renameDraft)
                          setRenaming(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            renameCat(c.key, renameDraft)
                            setRenaming(null)
                          }
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        className="h-7 flex-1 text-[13px]"
                      />
                    ) : (
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left text-[13px] text-fg"
                        onClick={() => {
                          setRenaming(c.key)
                          setRenameDraft(c.label)
                        }}
                        title={t("cats.renameTitle")}
                      >
                        {c.label}
                      </button>
                    )}
                    <span className="shrink-0 text-[11px] text-faint">{countOf(c.key)}</span>
                    {!c.builtin && (
                      <button
                        type="button"
                        onClick={() => removeCat(c.key)}
                        disabled={saving}
                        className="shrink-0 rounded-md px-1.5 text-[11px] text-danger hover:bg-danger/10"
                        title={t("cats.deleteTitle")}
                      >
                        {t("cats.del")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2 border-t border-line-soft pt-3">
                <Input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCat()}
                  placeholder={t("cats.newPlaceholder")}
                  className="h-9 flex-1"
                />
                <Button size="sm" variant="secondary" className="shrink-0" onClick={addCat} disabled={saving || !newLabel.trim()}>
                  {t("cats.add")}
                </Button>
              </div>
            </>
          )}
        </Card>

        {/* 映射编辑 */}
        <Card className="min-w-0 overflow-hidden p-0">
          <div className="px-4 py-3">
            <SectionTitle title={t('mapping.title')} desc={data ? t('mapping.count', { count: apps.length }) : undefined} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("mapping.searchPlaceholder")}
              className="mt-2 h-9"
            />
          </div>
          {!data ? (
            <Skeleton className="mx-4 mb-4 h-72" />
          ) : (
            <ul className="max-h-[560px] overflow-y-auto">
              {filteredApps.map((app) => {
                const current = data.rules[app] ?? ''
                const known = rank.data?.data.apps.find((a) => a.app.toLowerCase() === app)
                return (
                  <li
                    key={app}
                    className="flex items-center gap-3 border-t border-line-soft px-4 py-2 first:border-t-0"
                  >
                    <AppIcon app={known?.app ?? app} cat={current || 'other'} target={device} token={device.token} size={32} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{known?.app ?? app}</span>
                    {/* Select 触发器自带 w-full（纯 clsx 无 tailwind-merge，外层 w-36 压不掉），
                        用定宽容器约束，避免把行撑出横向滚动 */}
                    <span className="w-36 shrink-0">
                    <Select
                      aria-label={t("mapping.ariaFor", { app })}
                      value={current}
                      onChange={(e) => setRule(app, e.target.value)}
                      className="h-9"
                    >
                      <option value="">{t("mapping.unclassified")}</option>
                      {data.cats.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                    </span>
                  </li>
                )
              })}
              {filteredApps.length === 0 && (
                <li className="px-4 py-10 text-center text-[12.5px] text-muted">{t("mapping.noMatch")}</li>
              )}
            </ul>
          )}
        </Card>
      </div>

      {/* 二期：采集与隐私 + 数据管理。活动组内聚合，避免设置页跨组与新增路由 */}
      <CollectionSettingsCard device={device} />
      <DataManageCard device={device} />
    </div>
  )
}

function monthNow(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
