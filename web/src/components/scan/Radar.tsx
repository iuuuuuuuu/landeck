import { blipFor } from './polar'

export interface RadarNode {
  id: string
  paired: boolean
}

/**
 * 发现页的视觉主角：同心圆 + 旋转扫描扇形 + 按 id 哈希散落的设备点。
 * 配对成功的点变绿并常亮，未配对的点呼吸闪烁。
 * 描边/填充一律走设计令牌（SVG 展示属性不支持 var()，所以用 style 传）。
 */
export function Radar({
  nodes,
  scanning,
  className,
}: {
  nodes: RadarNode[]
  scanning: boolean
  className?: string
}) {
  return (
    <div className={className}>
      <svg viewBox="0 0 100 100" className="h-auto w-full" role="img" aria-label="局域网扫描雷达">
        <defs>
          <radialGradient id="ldk-radar-bg" cx="50%" cy="50%" r="50%">
            <stop
              offset="0%"
              style={{ stopColor: 'var(--tone-accent-glow)', stopOpacity: 0.5 }}
            />
            <stop
              offset="62%"
              style={{ stopColor: 'var(--tone-cyan-glow)', stopOpacity: 0.36 }}
            />
            <stop offset="100%" style={{ stopColor: 'var(--tone-cyan-glow)', stopOpacity: 0 }} />
          </radialGradient>
          <linearGradient id="ldk-radar-sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" style={{ stopColor: 'var(--tone-accent-a)', stopOpacity: 0 }} />
            <stop offset="60%" style={{ stopColor: 'var(--tone-accent-a)', stopOpacity: 0.16 }} />
            <stop offset="100%" style={{ stopColor: 'var(--tone-accent-a)', stopOpacity: 0.46 }} />
          </linearGradient>
        </defs>

        {/* 底盘 */}
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="url(#ldk-radar-bg)"
          style={{ stroke: 'var(--color-line)' }}
          strokeWidth={0.4}
        />
        {/* 三层同心圆 */}
        <circle
          cx="50"
          cy="50"
          r="34"
          fill="none"
          style={{ stroke: 'var(--color-line-soft)' }}
          strokeWidth={0.3}
        />
        <circle
          cx="50"
          cy="50"
          r="22"
          fill="none"
          style={{ stroke: 'var(--color-line-soft)' }}
          strokeWidth={0.3}
          strokeDasharray="1 1.8"
        />
        <circle
          cx="50"
          cy="50"
          r="11"
          fill="none"
          style={{ stroke: 'var(--color-line-soft)' }}
          strokeWidth={0.3}
        />
        {/* 十字准线 */}
        <line
          x1="50"
          y1="4"
          x2="50"
          y2="96"
          style={{ stroke: 'var(--color-line-soft)' }}
          strokeWidth={0.3}
        />
        <line
          x1="4"
          y1="50"
          x2="96"
          y2="50"
          style={{ stroke: 'var(--color-line-soft)' }}
          strokeWidth={0.3}
        />
        {/* 方位刻度 */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
          const rad = (a * Math.PI) / 180
          return (
            <line
              key={a}
              x1={50 + Math.cos(rad) * 43.5}
              y1={50 + Math.sin(rad) * 43.5}
              x2={50 + Math.cos(rad) * 46}
              y2={50 + Math.sin(rad) * 46}
              style={{ stroke: 'var(--color-line-strong)' }}
              strokeWidth={0.5}
            />
          )
        })}

        {/* 扫描扇形 */}
        {scanning && (
          <g className="animate-sweep" style={{ transformOrigin: '50px 50px' }}>
            <path d="M50 50 L50 4 A46 46 0 0 1 77.5 11.3 Z" fill="url(#ldk-radar-sweep)" />
            <line
              x1="50"
              y1="50"
              x2="50"
              y2="4"
              style={{ stroke: 'var(--tone-accent-a)' }}
              strokeOpacity={0.75}
              strokeWidth={0.4}
            />
          </g>
        )}

        {/* 中心点 */}
        <circle cx="50" cy="50" r="1.4" style={{ fill: 'var(--color-fg)' }} opacity={0.9} />
        <circle
          cx="50"
          cy="50"
          r="3.4"
          fill="none"
          style={{ stroke: 'var(--tone-accent-a)' }}
          strokeOpacity={0.35}
          strokeWidth={0.35}
        />

        {/* 发现节点 */}
        {nodes.map((n) => {
          const p = blipFor(n.id)
          const color = n.paired ? 'var(--color-ok)' : 'var(--color-accent-soft)'
          return (
            // 刻意不用 framer-motion 的 motion.g。
            // 实测：扫描时设备陆续冒出来，每个点都让 framer-motion 做一次
            // 布局测量；节点一多就把主线程占死，连雷达的 CSS 扫描动画
            // （animate-sweep，本来是纯合成层）都停住不动了，切页也卡。
            // 改成 CSS 关键帧淡入：只动 opacity，走合成层，不读布局。
            <g key={n.id} className="radar-blip">
              <circle
                cx={p.x}
                cy={p.y}
                r={n.paired ? 4.6 : 3.6}
                style={{ fill: color }}
                opacity={0.16}
                className={n.paired ? '' : 'animate-breathe'}
              />
              <circle cx={p.x} cy={p.y} r={n.paired ? 1.9 : 1.5} style={{ fill: color }} />
              {n.paired && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="3.2"
                  fill="none"
                  strokeWidth={0.4}
                  style={{ stroke: color }}
                  opacity={0.55}
                />
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
