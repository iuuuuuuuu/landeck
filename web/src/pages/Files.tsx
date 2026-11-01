import { useCallback, useState, type ReactNode } from 'react'
import { Button, Card, EmptyState, Skeleton } from '../components/ui'
import { RotateCw, ShieldAlert } from 'lucide-react'
import type { AgentClient } from '../lib/api'
import type { PairedDevice } from '../store/app'
import { LOCAL_DOWN_HINT, useActiveTarget } from '../lib/useActiveTarget'
import { useFetch } from '../components/device/useFetch'
import { fileRootsKey, systemKey } from '../lib/keys'
import { DevicePicker } from '../components/shell'
import { AuthLost } from '../components/device/AuthLost'
import { errText, isAuthError, isAuthMessage } from '../components/device/apiHelpers'
import { FileBrowser } from '../components/files/FileBrowser'
import { PageHeader } from '../components/shell'
import { useT } from '../i18n'

/** 本机目标的失败文案：别让用户以为是自己网络断了。t 由调用方传入（模块级函数保持纯度）。 */
function localError(err: unknown, t: (k: string) => string): { title: string; desc: string } {
  if (isAuthError(err)) {
    return {
      title: t('localError.tokenTitle'),
      desc: t('localError.tokenDesc'),
    }
  }
  return { title: t('localError.downTitle'), desc: `${LOCAL_DOWN_HINT}（${errText(err)}）` }
}

/**
 * 文件管理面板：只针对传入的这台设备，不再让用户在弹层里选设备。
 * 设备详情页的抽屉与（历史）独立页面共用这一份实现。
 */
export function FilesPanel({
  device,
  client,
  isLocal = false,
  onAuthError,
  /** 页头附加控件（独立页放设备选择器；详情页抽屉不传） */
  headerExtra,
}: {
  device: PairedDevice
  client: AgentClient
  isLocal?: boolean
  onAuthError?: () => void
  headerExtra?: ReactNode
}) {
  const t = useT('files')
  /** 目标身份：换设备 / 换令牌都要重新拉数据 */
  const targetKey = [device.id, client.target.host, client.target.port, client.token]

  const sys = useFetch(() => client.system(), targetKey, onAuthError, {
    // 与设备详情/设置页共用同一条系统信息缓存
    key: systemKey(client),
    ttlMs: 5 * 60_000,
  })
  const filesOn = sys.data?.features?.files !== false

  const roots = useFetch(filesOn ? () => client.fileRoots() : null, [...targetKey, filesOn], onAuthError, {
    // 根目录列表变化很少，缓存 2 分钟
    key: filesOn ? fileRootsKey(client) : undefined,
    ttlMs: 2 * 60_000,
  })

  return (
    <div className="space-y-3">
      <PageHeader
        title={t("title")}
        sub={t("subtitle")}
        actions={
          <>
            {headerExtra}
            <Button
              variant="secondary"
              size="md"
              icon={
                <RotateCw size={14} className={sys.loading || roots.loading ? 'animate-spin' : undefined} />
              }
            onClick={() => {
              sys.reload()
              roots.reload()
            }}
              disabled={sys.loading || roots.loading}
            >
              {t("actions.refresh")}
            </Button>
          </>
        }
      />

      {sys.loading && !sys.data ? (
        <Card>
          <Skeleton className="h-[220px] w-full rounded-2xl" />
        </Card>
      ) : sys.error && !sys.data ? (
        <Card>
          <EmptyState
            icon={<ShieldAlert size={24} />}
            title={isLocal ? localError(sys.error, t).title : t('sysError')}
            desc={
              isLocal
                ? localError(sys.error, t).desc
                : isAuthMessage(errText(sys.error))
                  ? t('pairLost')
                  : errText(sys.error)
            }
            action={
              <Button variant="secondary" onClick={sys.reload}>
                {t("actions.retry")}
              </Button>
            }
          />
        </Card>
      ) : !filesOn ? (
        <Card>
          <EmptyState
            icon={<ShieldAlert size={26} />}
            title={t("disabled.title")}
            desc={t("disabled.desc")}
          />
        </Card>
      ) : roots.error ? (
        <Card>
          <EmptyState
            icon={<ShieldAlert size={24} />}
            title={isLocal ? localError(roots.error, t).title : t('rootsError')}
            desc={isLocal ? localError(roots.error, t).desc : errText(roots.error)}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  if (isAuthError(roots.error)) onAuthError?.()
                  roots.reload()
                }}
              >
                {t("actions.retry")}
              </Button>
            }
          />
        </Card>
      ) : roots.loading && !roots.data ? (
        <Card>
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        </Card>
      ) : (
        <FileBrowser
          key={device.id}
          client={client}
          allowWrite={roots.data?.allowWrite === true}
          roots={roots.data?.roots ?? []}
          onAuthError={onAuthError}
        />
      )}
    </div>
  )
}

/**
 * 历史独立页：路由已重定向到 /devices，这里保留页面外壳（含设备下拉 + 本机目标），
 * 方便以后从别处再次挂载，也保证本文件自洽。
 */
export default function Files() {
  const t = useT('files')
  const { devices, device, deviceId, setDeviceId, isLocal, pairedCount, client } = useActiveTarget()
  // 401 记在「哪个目标上」：换目标后自动失效，不用 effect 去清，也不会被旧结果卡住
  const [authLostFor, setAuthLostFor] = useState<string | null>(null)
  const authLost = authLostFor === deviceId

  /** 本机的 401 不是「配对失效」，没有重新配对这回事，别整页劫持 */
  const onAuthError = useCallback(() => {
    if (!isLocal) setAuthLostFor(deviceId)
  }, [isLocal, deviceId])

  if (authLost) return <AuthLost />

  return (
    <div className="space-y-3">
      {/* 设备选择并入 PageHeader actions（旧版是页顶孤立卡片条，QA 走查判为必修） */}
      <FilesPanel
        device={device}
        client={client}
        isLocal={isLocal}
        onAuthError={onAuthError}
        headerExtra={
          <>
            <DevicePicker devices={devices} value={deviceId} onChange={setDeviceId} />
            {pairedCount === 0 && (
              <span className="text-[11.5px] text-faint">{t("noPairedHint")}</span>
            )}
          </>
        }
      />
    </div>
  )
}
