import { useCallback, useState } from 'react'
import { Button, Card, EmptyState, Skeleton } from '../components/ui'
import { FolderTree, ShieldAlert } from 'lucide-react'
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

/** 文件管理页：设备选择（含本机）+ 根目录 / 目录浏览，功能开关关掉时整块提示 */
export default function Files() {
  const { devices, deviceId, setDeviceId, isLocal, pairedCount, client } = useActiveTarget()
  // 401 记在「哪个目标上」：换目标后自动失效，不用 effect 去清，也不会被旧结果卡住
  const [authLostFor, setAuthLostFor] = useState<string | null>(null)
  const authLost = authLostFor === deviceId

  /** 目标身份：换设备 / 换令牌都要重新拉数据 */
  const targetKey = [deviceId, client.target.host, client.target.port, client.token]
  /** 本机的 401 不是「配对失效」，没有重新配对这回事，别整页劫持 */
  const onAuthError = useCallback(() => {
    if (!isLocal) setAuthLostFor(deviceId)
  }, [isLocal, deviceId])

  const sys = useFetch(() => client.system(), targetKey, onAuthError)
  const filesOn = sys.data?.features?.files !== false

  const roots = useFetch(
    filesOn ? () => client.fileRoots() : null,
    [...targetKey, filesOn],
    onAuthError,
  )

  if (authLost) return <AuthLost />

  return (
    <div className="space-y-3">
      <Card padded={false} className="flex flex-wrap items-center gap-2 p-2.5">
        <DeviceSelect devices={devices} value={deviceId} onChange={setDeviceId} />
        {pairedCount === 0 && (
          <span className="text-[11.5px] text-faint">还没有已配对的设备，当前显示本机</span>
        )}
        <span className="hidden items-center gap-1.5 text-[11.5px] text-faint sm:inline-flex">
          <FolderTree size={12} />
          浏览、下载、上传、新建目录、重命名与删除
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            className="h-10"
            onClick={() => {
              sys.reload()
              roots.reload()
            }}
            disabled={sys.loading || roots.loading}
          >
            刷新
          </Button>
        </div>
      </Card>

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
                  if (isAuthError(roots.error)) onAuthError()
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
          key={deviceId}
          client={client}
          allowWrite={roots.data?.allowWrite === true}
          roots={roots.data?.roots ?? []}
          onAuthError={onAuthError}
        />
      )}
    </div>
  )
}
