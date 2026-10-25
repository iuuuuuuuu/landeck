import { useCallback, useState } from 'react'
import { Button, Card, EmptyState, Skeleton } from '../components/ui'
import { FolderTree, RotateCw, ShieldAlert } from 'lucide-react'
import type { AgentClient } from '../lib/api'
import type { PairedDevice } from '../store/app'
import { LOCAL_DOWN_HINT, useActiveTarget } from '../lib/useActiveTarget'
import { useFetch } from '../components/device/useFetch'
import { DeviceSelect } from '../components/device/DeviceSelect'
import { AuthLost } from '../components/device/AuthLost'
import { errText, isAuthError, isAuthMessage } from '../components/device/apiHelpers'
import { FileBrowser } from '../components/files/FileBrowser'

/** 本机目标的失败文案：别让用户以为是自己网络断了 */
function localError(err: unknown): { title: string; desc: string } {
  if (isAuthError(err)) {
    return {
      title: '本机访问需要令牌',
      desc: '被控端关掉了「本机免令牌」，到那台电脑的「设置」里重新开启即可。',
    }
  }
  return { title: '本机被控端无响应', desc: `${LOCAL_DOWN_HINT}（${errText(err)}）` }
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
}: {
  device: PairedDevice
  client: AgentClient
  isLocal?: boolean
  onAuthError?: () => void
}) {
  /** 目标身份：换设备 / 换令牌都要重新拉数据 */
  const targetKey = [device.id, client.target.host, client.target.port, client.token]

  const sys = useFetch(() => client.system(), targetKey, onAuthError)
  const filesOn = sys.data?.features?.files !== false

  const roots = useFetch(
    filesOn ? () => client.fileRoots() : null,
    [...targetKey, filesOn],
    onAuthError,
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11.5px] text-faint">
          <FolderTree size={12} className="shrink-0" />
          <span className="truncate">浏览、下载、上传、新建目录、重命名与删除</span>
        </span>
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto h-9"
          icon={
            <RotateCw size={13} className={sys.loading || roots.loading ? 'animate-spin' : undefined} />
          }
          onClick={() => {
            sys.reload()
            roots.reload()
          }}
          disabled={sys.loading || roots.loading}
        >
          刷新
        </Button>
      </div>

      {sys.loading && !sys.data ? (
        <Card>
          <Skeleton className="h-[220px] w-full rounded-2xl" />
        </Card>
      ) : sys.error && !sys.data ? (
        <Card>
          <EmptyState
            icon={<ShieldAlert size={24} />}
            title={isLocal ? localError(sys.error).title : '读取设备信息失败'}
            desc={
              isLocal
                ? localError(sys.error).desc
                : isAuthMessage(errText(sys.error))
                  ? '配对失效，请重新配对'
                  : errText(sys.error)
            }
            action={
              <Button variant="secondary" onClick={sys.reload}>
                重试
              </Button>
            }
          />
        </Card>
      ) : !filesOn ? (
        <Card>
          <EmptyState
            icon={<ShieldAlert size={26} />}
            title="文件管理已在设置里关闭"
            desc="在被控端「设置 → 文件管理」中开启后，这里会出现浏览、上传与下载入口。"
          />
        </Card>
      ) : roots.error ? (
        <Card>
          <EmptyState
            icon={<ShieldAlert size={24} />}
            title={isLocal ? localError(roots.error).title : '文件根目录读取失败'}
            desc={isLocal ? localError(roots.error).desc : errText(roots.error)}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  if (isAuthError(roots.error)) onAuthError?.()
                  roots.reload()
                }}
              >
                重试
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
      <Card padded={false} className="flex flex-wrap items-center gap-2 p-2.5">
        <DeviceSelect devices={devices} value={deviceId} onChange={setDeviceId} />
        {pairedCount === 0 && (
          <span className="text-[11.5px] text-faint">还没有已配对的设备，当前显示本机</span>
        )}
      </Card>
      <FilesPanel device={device} client={client} isLocal={isLocal} onAuthError={onAuthError} />
    </div>
  )
}
