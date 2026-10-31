/**
 * 远程桌面 WebSocket 客户端（phase4 设计文档 B 节 RD-1 契约）。
 *
 * 帧格式（一字不差照文档，字段名与 agent-rd 共享）：
 *  - agent → viewer：二进制 WS 帧 `[0x01][4B unixMs 大端][JPEG bytes]`；
 *    0x02 预留（光标状态更新）。
 *  - viewer → agent：JSON 文本帧
 *      {t:"m", x, y, b:"l"|"r"|"m", a:"move"|"down"|"up"|"dbl"}  x/y 归一 0..1
 *      {t:"w", dy}  dy 正数向上
 *      {t:"k", code, mods:["ctrl","shift","alt","meta"], down}
 *      {t:"txt", text}
 *      {t:"q", quality} / {t:"fps", fps}
 *      {t:"hello"}/{t:"bye"}/{t:"ping"}/{t:"pong"} 双向控制帧
 *
 * 会话语义：第二个 viewer 连入会收到 {type:"busy"} 并被服务端关闭；
 * 断线自动重连（指数退避，3 次后转 failed 交手动重连）。
 */
import type { Target } from './api'

export type RdState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'busy'
  | 'reconnecting'
  | 'failed'
  | 'demo'

export interface RdFrame {
  /** 服务端抓帧时刻（unix ms，大端 4B） */
  ts: number
  jpeg: Uint8Array
}

export interface RdHandlers {
  onFrame?: (f: RdFrame) => void
  /** 会话建立，被控端回传的来源标识帧 */
  onHello?: (peer: { name: string; os: string }) => void
  /** 被控端有其他远程会话，本连接被拒 */
  onBusy?: () => void
  /** 连接层状态变化（重连计数等） */
  onState?: (s: RdState, attempt: number) => void
  /** 服务端bye或链路断开且不再重连 */
  onClosed?: (reason: 'bye' | 'failed') => void
}

/** 与 agent-rd 对齐：RD 流端点（token 走 query，同 icons 模式——<img>/WS 带不了头）。 */
export function rdStreamUrl(t: Target, token: string | undefined): string {
  const path = `/api/v1/rd/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`
  if (t.local) return `ws://127.0.0.1:${t.port}/api/v1${path.replace('/api/v1', '')}`
  return `${t.tls ? 'wss' : 'ws'}://${t.host}:${t.port}/api/v1${path.replace('/api/v1', '')}`
}

const MAX_ATTEMPTS = 3

export class RdClient {
  private ws: WebSocket | null = null
  private target: Target
  private token: string | undefined
  private handlers: RdHandlers
  private attempt = 0
  private reconnectTimer: number | null = null
  private disposed = false
  private pingTimer: number | null = null

  /** 最近一帧时间（viewer 用于显示链路健康） */
  lastFrameAt = 0

  constructor(target: Target, token: string | undefined, handlers: RdHandlers) {
    this.target = target
    this.token = token
    this.handlers = handlers
  }

  get state(): RdState {
    return this.stateVal
  }
  private stateVal: RdState = 'idle'
  private setState(s: RdState, attempt = this.attempt) {
    this.stateVal = s
    this.handlers.onState?.(s, attempt)
  }

  connect(): void {
    this.disposed = false
    this.open()
  }

  private open(): void {
    if (this.disposed) return
    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(rdStreamUrl(this.target, this.token))
    } catch {
      this.scheduleReconnect()
      return
    }
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onopen = () => {
      if (this.disposed) return
      this.attempt = 0
      this.setState('connected')
      // 应用层心跳：60s 没动静链路会被掐，客户端先 ping 防呆
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping' }), 30_000)
    }

    ws.onmessage = (ev) => {
      if (this.disposed) return
      const data = ev.data
      if (typeof data === 'string') {
        let msg: { type?: string; t?: string; name?: string; os?: string } | null = null
        try {
          msg = JSON.parse(data)
        } catch {
          return
        }
        // 服务端用 {type:...}（busy）或 {t:...}（hello/bye/pong）两种键都认，
        // 以 agent-rd 实际实现为准——两处都解析，字段名不改。
        if (msg?.type === 'busy' || msg?.t === 'busy') {
          this.setState('busy')
          this.handlers.onBusy?.()
          this.closeNow()
          return
        }
        if (msg?.t === 'hello' || msg?.type === 'hello') {
          this.handlers.onHello?.({ name: msg.name ?? '', os: msg.os ?? '' })
          return
        }
        if (msg?.t === 'bye' || msg?.type === 'bye') {
          this.dispose('bye')
          this.handlers.onClosed?.('bye')
          return
        }
        // ping/pong 静默处理
        return
      }
      // 二进制帧：[0x01][4B unixMs 大端][JPEG]
      const buf = data as ArrayBuffer
      if (buf.byteLength < 5) return
      const u8 = new Uint8Array(buf)
      if (u8[0] !== 0x01) return // 0x02 等预留类型，本期忽略
      const dv = new DataView(buf)
      const ts = dv.getUint32(1, false)
      this.lastFrameAt = Date.now()
      this.handlers.onFrame?.({ ts, jpeg: u8.subarray(5) })
    }

    ws.onclose = () => {
      if (this.disposed) return
      this.ws = null
      if (this.pingTimer !== null) {
        clearInterval(this.pingTimer)
        this.pingTimer = null
      }
      this.scheduleReconnect()
    }

    ws.onerror = () => {
      // onclose 会跟着来，重连统一在 onclose 走
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return
    if (this.attempt >= MAX_ATTEMPTS) {
      this.setState('failed')
      this.handlers.onClosed?.('failed')
      return
    }
    this.attempt += 1
    this.setState('reconnecting', this.attempt)
    // 指数退避：1s / 2s / 4s
    const delay = Math.min(1000 * 2 ** (this.attempt - 1), 8000)
    this.reconnectTimer = window.setTimeout(() => this.open(), delay)
  }

  /** 手动重连（failed 后的用户按钮）：清零计数重来。 */
  reconnectManually(): void {
    this.clearReconnect()
    this.attempt = 0
    this.open()
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private closeNow(): void {
    this.clearReconnect()
    const ws = this.ws
    this.ws = null
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    ws?.close()
  }

  /** 主动断开（bye + 关链路），之后不再重连。 */
  dispose(reason: 'bye' | 'silent' = 'silent'): void {
    this.disposed = true
    if (this.stateVal === 'connected') {
      try {
        this.ws?.send(JSON.stringify({ t: 'bye' }))
      } catch {
        /* 链路可能已死 */
      }
    }
    this.closeNow()
    this.stateVal = 'idle'
    void reason
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /** 发送 JSON 输入帧；链路未开时静默丢弃（输入是尽力而为，不排队）。 */
  send(obj: Record<string, unknown>): void {
    if (!this.isOpen) return
    try {
      this.ws?.send(JSON.stringify(obj))
    } catch {
      /* 忽略 */
    }
  }
}
