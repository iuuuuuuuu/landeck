import { useEffect, useMemo, useState } from 'react'
import { Button, Card, EmptyState, Skeleton } from '../components/ui'
import { FolderTree, ShieldAlert, Unplug } from 'lucide-react'
import { useApp } from '../store/app'
import { useClient } from '../lib/hooks'
import { useFetch } from '../components/device/useFetch'
import { DeviceSelect } from '../components/device/DeviceSelect'
import { AuthLost } from '../components/device/AuthLost'
import { errText, isAuthError, isAuthMessage } from '../components/device/apiHelpers'
import { FileBrowser } from '../components/files/FileBrowser'

/** 文件管理页：设备选择 + 根目录 / 目录浏览，功能开关关掉时整块提示 */
export default function Files() {
  const devices = useApp((s) => s.devices)
  const activeId = useApp((s) => s.activeId)
  const [deviceId, setDeviceId] = useState<string | null>(activeId ?? devices[0]?.id ?? null)
  const device = useMemo(
    () => devices.find((d) => d.id === deviceId) ?? devices[0] ?? null,
    [devices, deviceId],
  )
  const client = useClient(device)
  const [authLost, setAuthLost] = useState(false)

  useEffect(() => {
    if (device && device.id !== deviceId) setDeviceId(device.id)
  }, [device, deviceId])

  const sys = useFetch(
    client ? () => client.system() : null,
    [client?.target.host, client?.target.port, client?.token],
    () => setAuthLost(true),
  )
  const filesOn = sys.data?.features?.files !== false

  const roots = useFetch(
    client && filesOn ? () => client.fileRoots() : null,
    [client?.target.host, client?.target.port, client?.token, filesOn],
    () => setAuthLost(true),
  )

  if (authLost) return <AuthLost />

  return (
    <div className="space-y-3">
      <Card padded={false} className="flex flex-wrap items-center gap-2 p-2.5">
        {devices.length > 0 ? (
          <DeviceSelect devices={devices} value={device?.id ?? null} onChange={setDeviceId} />
        ) : (
          <span className="px-1 text-[12.5px] text-muted">还没有已配对的设备</span>
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
            disabled={sys.loading || roots.loading || !device}
          >
            刷新
          </Button>
        </div>
      </Card>

      {devices.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Unplug size={26} />}
            title="还没有已配对的设备"
            desc="文件管理挂在具体设备上，先扫描并配对一台电脑。"
          />
        </Card>
      ) : sys.loading && !sys.data ? (
        <Card>
          <Skeleton className="h-[220px] w-full rounded-2xl" />
        </Card>
      ) : sys.error && !sys.data ? (
        <Card>
          <EmptyState
            icon={<ShieldAlert size={24} />}
            title="读取设备信息失败"
            desc={isAuthMessage(errText(sys.error)) ? '配对失效，请重新配对' : errText(sys.error)}
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
            title="文件根目录读取失败"
            desc={errText(roots.error)}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  if (isAuthError(roots.error)) setAuthLost(true)
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
      ) : client ? (
        <FileBrowser
          key={`${client.target.host}:${client.target.port}`}
          client={client}
          allowWrite={roots.data?.allowWrite === true}
          roots={roots.data?.roots ?? []}
          onAuthError={() => setAuthLost(true)}
        />
      ) : null}
    </div>
  )
}
