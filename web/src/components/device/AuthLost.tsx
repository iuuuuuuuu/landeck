import { Button, Card } from '../ui'
import { Unplug } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

/** 401 统一落地页：整页替换内容，只留一条重新配对路径 */
export function AuthLost({ compact }: { compact?: boolean }) {
  const navigate = useNavigate()
  return (
    <div className={compact ? 'px-1 py-8' : 'grid min-h-[62vh] place-items-center px-4 py-10'}>
      <Card className="w-full max-w-md text-center" glow>
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-danger/25 bg-danger/10 text-danger">
          <Unplug size={24} />
        </div>
        <h2 className="mt-4 text-[17px] font-semibold text-fg">配对失效，请重新配对</h2>
        <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-muted">
          设备令牌已过期或被吊销。重新配对后可继续控制这台电脑，历史设置不会丢失。
        </p>
        <div className="mt-5 flex justify-center">
          <Button variant="primary" size="lg" onClick={() => navigate('/scan')}>
            重新配对
          </Button>
        </div>
      </Card>
    </div>
  )
}
