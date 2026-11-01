import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot, Clock, TriangleAlert } from 'lucide-react'
import { Badge, Button, Card, Field, Input, SectionTitle, Skeleton, Toggle } from '../../components/ui'
import { PageHeader } from '../../components/shell'
import { useFetch } from '../../components/device/useFetch'
import { aiSettingsKey } from '../../lib/aiKeys'
import { AI_CLOUD_PRESETS, fetchAiSettings, putAiSettings, sendChat, type AiProvider, type AiSettings } from '../../lib/aiApi'
import { invalidateCache } from '../../lib/queryCache'
import { useApp } from '../../store/app'
import { useActiveTarget } from '../../lib/useActiveTarget'
import { useT } from '../../i18n'
import { AiNoDeviceGuide } from './shared'
import { apiErrorMessage } from '../../components/pair/errors'

/**
 * AI 设置 /ai/settings。
 *
 * 与 agent-ai 的契约：GET/PUT /ai/settings（部分更新）。404 = agent 版本过老
 * （< 1.0.19）——顶部横幅说明、表单仍可填写，但保存/测试会真实报错（吐司），
 * 不做假保存。ai_not_configured 不会出现在设置页本身。
 *
 * 密钥安全：响应只有 hasKey/keyTail，永不回传明文；apiKey 仅在用户本轮输入
 * 了新值时随 PUT 带；「清除密钥」单独发 {clearKey:true}。
 */
export default function AiSettingsPage() {
  const t = useT('ai')
  const toast = useApp((s) => s.toast)
  const { device, pairedCount, localAvailable } = useActiveTarget()
  const dev = device ?? null

  // 用 useFetch 而不是 useAsync：error 保留原始 ApiError，页面才能按 status===404
  // 分流「版本过老」横幅（useAsync 的 error 已被压成 string，状态码丢了）。
  const q = useFetch<AiSettings>(dev ? () => fetchAiSettings(dev, dev.token) : null, [dev?.host, dev?.port, dev?.token], undefined, {
    key: dev ? aiSettingsKey(dev) : undefined,
  })

  const [notFound, setNotFound] = useState(false)
  const [form, setForm] = useState<AiSettings | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [savingAuto, setSavingAuto] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (q.data) {
      setForm(q.data)
      setNotFound(false)
    }
  }, [q.data])

  useEffect(() => {
    if (q.error) {
      const status = (q.error as { status?: number }).status
      const legacy = status === 404 || status === 501
      setNotFound(legacy)
      // 404 = agent 版本过老：按 brief 进「可填表单」（默认值），错误卡只给其它错误——
      // 用户可以在升级前把配置填好，升级后保存即可生效。
      if (legacy) {
        setForm((f) => f ?? { provider: 'openai', baseURL: '', model: '', hasKey: false, keyTail: '', enabled: true, chat: { model: '' } })
      }
    } else {
      setNotFound(false)
    }
  }, [q.error])

  const save = useCallback(
    async (patchExtra?: { clearKey?: boolean }) => {
      if (!dev || !form) return
      setSaving(true)
      try {
        const patch: Record<string, unknown> = {
          provider: form.provider,
          baseURL: form.baseURL.trim(),
          model: form.model.trim(),
          enabled: form.enabled,
          chat: { model: form.chat?.model ?? '' },
        }
        if (apiKeyInput.trim()) patch.apiKey = apiKeyInput.trim()
        if (patchExtra?.clearKey) patch.clearKey = true
        const next = await putAiSettings(dev, dev.token, patch)
        setForm(next)
        setApiKeyInput('')
        invalidateCache(aiSettingsKey(dev))
        void q.reload()
        toast({ kind: 'ok', title: t('settings.saved') })
      } catch (e) {
        toast({
          kind: 'error',
          title: t('settings.saveFailed'),
          desc: apiErrorMessage(e, notFound ? t('settings.agentTooOld') : undefined),
        })
      } finally {
        setSaving(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dev, form, apiKeyInput, notFound],
  )

  // 自动总结单独保存：只发 autoSummary 字段（PUT 部分更新，不会动其它配置）
  const saveAuto = useCallback(async () => {
    if (!dev || !form?.autoSummary) return
    setSavingAuto(true)
    try {
      const next = await putAiSettings(dev, dev.token, { autoSummary: form.autoSummary })
      setForm(next)
      invalidateCache(aiSettingsKey(dev))
      void q.reload()
      toast({
        kind: 'ok',
        title: next.autoSummary?.enabled ? t('settings.autoSummarySaved') : t('settings.autoSummaryOff'),
        desc: next.autoSummary?.enabled ? t('settings.autoSummaryDaily', { time: next.autoSummary.time }) : undefined,
      })
    } catch (e) {
      toast({ kind: 'error', title: t('settings.autoSummarySaveFailed'), desc: apiErrorMessage(e, notFound ? t('settings.agentTooOld') : undefined) })
    } finally {
      setSavingAuto(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dev, form?.autoSummary, notFound])

  const testConnection = useCallback(async () => {
    if (!dev) return
    setTesting(true)
    setTestResult(null)
    try {
      // 先把表单当前值存下去再测，否则测的是旧配置——用户刚填完直接点测试是主流路径
      if (form) await save()
      const r = await sendChat(dev, dev.token, [{ role: 'user', content: 'ping' }])
      setTestResult({ ok: true, text: r.data.content.slice(0, 200) })
    } catch (e) {
      setTestResult({ ok: false, text: apiErrorMessage(e, t('settings.testFailed')) })
    } finally {
      setTesting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dev, form, save])

  if (!localAvailable && pairedCount === 0) return <AiNoDeviceGuide />

  const providerOptions: { value: AiProvider; label: string }[] = [
    { value: 'openai', label: t('settings.providerOpenai') },
    { value: 'ollama', label: t('settings.providerOllama') },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title={t("settings.title")} sub={t("settings.subtitle")} />

      {notFound && (
        <div className="flex items-start gap-2 rounded-xl border border-cyan/30 bg-cyan/[0.08] px-3 py-2.5 text-[12px] leading-relaxed text-cyan">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{t("settings.needAgent")}</span>
        </div>
      )}

      {q.loading && !form ? (
        <Card>
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        </Card>
      ) : q.error && !form ? (
        <Card>
          <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/[0.08] px-3 py-2.5 text-[12px] text-danger">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">{t("settings.readFailed")}{String(q.error instanceof Error ? q.error.message : q.error)}</span>
            <Button size="sm" variant="ghost" onClick={q.reload}>
              {t("settings.retry")}
            </Button>
          </div>
        </Card>
      ) : form ? (
        <>
          <Card>
            <SectionTitle icon={<Bot size={16} />} title={t("settings.sourceTitle")} desc={t("settings.sourceDesc")} />
            <div className="mt-3 space-y-3">
              <Field label={t("settings.provider")}>
                <div className="flex gap-2">
                  {providerOptions.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setForm({ ...form, provider: o.value })}
                      className={
                        'h-9 rounded-xl border px-3.5 text-[12.5px] transition-colors ' +
                        (form.provider === o.value
                          ? 'border-accent/40 bg-accent/[0.12] text-fg'
                          : 'border-line-soft bg-elevated text-muted hover:text-fg-soft')
                      }
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field
                label={t("settings.endpoint")}
                hint={form.provider === 'ollama' ? t('settings.endpointOllamaHint') : t('settings.endpointOpenaiHint2')}
              >
                <Input
                  value={form.baseURL}
                  onChange={(e) => setForm({ ...form, baseURL: e.target.value })}
                  placeholder={form.provider === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.openai.com/v1'}
                  spellCheck={false}
                />
              </Field>
              {form.provider === 'openai' && (
                <Field label={t("settings.cloudPresets")} hint={t("settings.cloudPresetsHint")}>
                  <div className="flex flex-wrap gap-1.5">
                    {AI_CLOUD_PRESETS.map((p) => {
                      const active = form.baseURL.trim().replace(/\/+$/, '') === p.baseURL
                      return (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => setForm({ ...form, baseURL: p.baseURL })}
                          className={
                            'h-8 rounded-full border px-3 text-[12px] transition-colors ' +
                            (active
                              ? 'border-accent/40 bg-accent/[0.12] text-fg'
                              : 'border-line-soft bg-elevated text-muted hover:text-fg-soft')
                          }
                        >
                          {p.label}
                        </button>
                      )
                    })}
                  </div>
                </Field>
              )}
              <Field label={t("settings.summaryModel")} hint={form.provider === 'ollama' ? t('settings.modelOllamaHint') : t('settings.modelCloudHint')}>
                <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder={t("settings.summaryModel")} spellCheck={false} />
              </Field>
              <Field label={t("settings.chatModel")} hint={t("settings.chatModelHint")}>
                <Input
                  value={form.chat?.model ?? ''}
                  onChange={(e) => setForm({ ...form, chat: { model: e.target.value } })}
                  placeholder={t("settings.chatModelPlaceholder")}
                  spellCheck={false}
                />
              </Field>
              <Field
                label={t("settings.apiKey")}
                hint={
                  form.hasKey
                    ? t('settings.keySaved', { tail: form.keyTail || '••••' }) + (apiKeyInput ? t('settings.keyWillOverwrite') : t('settings.keyUnchanged'))
                    : t('settings.keyOllamaHint')
                }
              >
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder={form.hasKey ? '••••••••' : 'sk-…'}
                    autoComplete="new-password"
                    spellCheck={false}
                  />
                  {form.hasKey && (
                    <Button size="md" variant="ghost" disabled={saving} onClick={() => void save({ clearKey: true })}>
                      {t("settings.clear")}
                    </Button>
                  )}
                </div>
              </Field>
              <Field label={t("settings.enabled")} hint={t("settings.enabledHint")}>
                <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label={t("settings.enabledShort")} />
              </Field>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2 border-t border-line-soft pt-3">
              <Button variant="secondary" loading={testing} disabled={saving} onClick={() => void testConnection()}>
                {t("settings.testConnection")}
              </Button>
              <Button variant="primary" loading={saving} disabled={testing} onClick={() => void save()}>
                {t("settings.save")}
              </Button>
            </div>
          </Card>

          {testResult && (
            <Card>
              <div className="flex items-start gap-2">
                <Badge tone={testResult.ok ? 'ok' : 'danger'}>{testResult.ok ? t('settings.testOk') : t('settings.testFail')}</Badge>
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-fg-soft">{testResult.text}</p>
              </div>
            </Card>
          )}

          {/* 自动总结（七期）：每天定时生成当天日报，agent 侧还会补齐缺失日报与上周周报 */}
          <Card>
            <SectionTitle icon={<Clock size={16} />} title={t("settings.autoSummary")} desc={t("settings.autoSummaryDesc")} />
            {form && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Toggle
                    checked={form.autoSummary?.enabled ?? false}
                    onChange={(v) => setForm({ ...form, autoSummary: { enabled: v, time: form.autoSummary?.time ?? '23:00' } })}
                    label={t("settings.autoDaily")}
                  />
                  <label className="flex items-center gap-2 text-[12.5px] text-muted">
                    {t("settings.genTime")}
                    <input
                      type="time"
                      value={form.autoSummary?.time ?? '23:00'}
                      onChange={(e) => setForm({ ...form, autoSummary: { enabled: form.autoSummary?.enabled ?? false, time: e.target.value } })}
                      disabled={!(form.autoSummary?.enabled ?? false)}
                      className="num h-9 rounded-xl border border-line-soft bg-elevated px-2.5 text-[13px] text-fg focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50"
                    />
                  </label>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-line-soft pt-3">
                  <Button
                    variant="primary"
                    loading={savingAuto}
                    disabled={testing || !form.model.trim()}
                    title={!form.model.trim() ? t('settings.needModelFirst') : undefined}
                    onClick={() => void saveAuto()}
                  >
                    {t("settings.saveAutoSummary")}
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-start gap-2 rounded-xl px-1 py-1 text-[11.5px] leading-relaxed text-muted">
              <p className="min-w-0 flex-1">
                {t("settings.privacy1")}
                {t("settings.privacy2")}{' '}
                <Link to="/ai/chat" className="text-accent hover:underline">
                  {t("settings.chatLink")}
                </Link>{' '}
                {t("settings.privacy3")}
              </p>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  )
}
