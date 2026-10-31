import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot, TriangleAlert } from 'lucide-react'
import { Badge, Button, Card, Field, Input, SectionTitle, Skeleton, Toggle } from '../../components/ui'
import { PageHeader } from '../../components/shell'
import { useFetch } from '../../components/device/useFetch'
import { aiSettingsKey } from '../../lib/aiKeys'
import { fetchAiSettings, putAiSettings, sendChat, type AiProvider, type AiSettings } from '../../lib/aiApi'
import { invalidateCache } from '../../lib/queryCache'
import { useApp } from '../../store/app'
import { useActiveTarget } from '../../lib/useActiveTarget'
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
        setForm((f) => f ?? { provider: 'openai', baseURL: '', model: '', hasKey: false, keyTail: '', enabled: true })
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
        }
        if (apiKeyInput.trim()) patch.apiKey = apiKeyInput.trim()
        if (patchExtra?.clearKey) patch.clearKey = true
        const next = await putAiSettings(dev, dev.token, patch)
        setForm(next)
        setApiKeyInput('')
        invalidateCache(aiSettingsKey(dev))
        void q.reload()
        toast({ kind: 'ok', title: 'AI 设置已保存' })
      } catch (e) {
        toast({
          kind: 'error',
          title: '保存失败',
          desc: apiErrorMessage(e, notFound ? '当前 Agent 版本没有 AI 功能（需要 1.0.19+）' : undefined),
        })
      } finally {
        setSaving(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dev, form, apiKeyInput, notFound],
  )

  const testConnection = useCallback(async () => {
    if (!dev) return
    setTesting(true)
    setTestResult(null)
    try {
      // 先把表单当前值存下去再测，否则测的是旧配置——用户刚填完直接点测试是主流路径
      if (form) await save()
      const r = await sendChat(dev, dev.token, [{ role: 'user', content: 'ping' }])
      setTestResult({ ok: true, text: r.data.slice(0, 200) })
    } catch (e) {
      setTestResult({ ok: false, text: apiErrorMessage(e, '连接失败') })
    } finally {
      setTesting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dev, form, save])

  if (!localAvailable && pairedCount === 0) return <AiNoDeviceGuide />

  const providerOptions: { value: AiProvider; label: string }[] = [
    { value: 'openai', label: 'OpenAI 兼容' },
    { value: 'ollama', label: 'Ollama 本地' },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="AI 设置" sub="配置被控端调用的大模型——总结与对话都由它生成" />

      {notFound && (
        <div className="flex items-start gap-2 rounded-xl border border-cyan/30 bg-cyan/[0.08] px-3 py-2.5 text-[12px] leading-relaxed text-cyan">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">AI 功能需要 LanDeck Agent 1.0.19+。当前被控端还没有这组接口，可以先填写，升级后保存即可生效。</span>
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
            <span className="min-w-0 flex-1">读取 AI 设置失败：{String(q.error instanceof Error ? q.error.message : q.error)}</span>
            <Button size="sm" variant="ghost" onClick={q.reload}>
              重试
            </Button>
          </div>
        </Card>
      ) : form ? (
        <>
          <Card>
            <SectionTitle icon={<Bot size={16} />} title="模型来源" desc="本地模型数据不出机器；云端 API 延迟低、模型选择多。" />
            <div className="mt-3 space-y-3">
              <Field label="提供方">
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
                label="服务地址"
                hint={form.provider === 'ollama' ? '例如 http://127.0.0.1:11434' : '例如 https://api.openai.com/v1（兼容各家 OpenAI 形状的端点）'}
              >
                <Input
                  value={form.baseURL}
                  onChange={(e) => setForm({ ...form, baseURL: e.target.value })}
                  placeholder={form.provider === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.openai.com/v1'}
                  spellCheck={false}
                />
              </Field>
              <Field label="模型" hint={form.provider === 'ollama' ? '例如 qwen2.5:7b、llama3.1:8b' : '例如 gpt-4o-mini、deepseek-chat'}>
                <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="模型名称" spellCheck={false} />
              </Field>
              <Field
                label="API 密钥"
                hint={
                  form.hasKey
                    ? `已保存（尾号 ${form.keyTail || '••••'}）${apiKeyInput ? '，本次输入将覆盖' : '，留空则不修改'}`
                    : 'Ollama 本地模型通常不需要'
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
                      清除
                    </Button>
                  )}
                </div>
              </Field>
              <Field label="启用 AI 功能" hint="关闭后对话与总结页会显示未启用提示，设置保留。">
                <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="启用" />
              </Field>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2 border-t border-line-soft pt-3">
              <Button variant="secondary" loading={testing} disabled={saving} onClick={() => void testConnection()}>
                测试连接
              </Button>
              <Button variant="primary" loading={saving} disabled={testing} onClick={() => void save()}>
                保存
              </Button>
            </div>
          </Card>

          {testResult && (
            <Card>
              <div className="flex items-start gap-2">
                <Badge tone={testResult.ok ? 'ok' : 'danger'}>{testResult.ok ? '连通' : '失败'}</Badge>
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-fg-soft">{testResult.text}</p>
              </div>
            </Card>
          )}

          <Card>
            <div className="flex items-start gap-2 rounded-xl px-1 py-1 text-[11.5px] leading-relaxed text-muted">
              <p className="min-w-0 flex-1">
                密钥保存在被控端本机（settings 文件），控制端只回传是否存在与尾号。对话与总结请求由被控端代理调用——
                控制端不直接连模型服务。配置问题见{' '}
                <Link to="/ai/chat" className="text-accent hover:underline">
                  AI 对话
                </Link>{' '}
                页的错误提示。
              </p>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  )
}
