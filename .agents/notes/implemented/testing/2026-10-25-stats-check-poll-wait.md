# Agent Note: 统计页自检改为「轮询等内容」而非固定 sleep

Status: implemented

## Problem

`tools/stats-check.mjs` 原来在导航到 `/stats` 之后固定 `sleep(4000)` 再断言页面出现「总览」。
平时能过，但 Agent 刚重启时必红：`/stats` 首次聚合要读 Windows 事件日志（开机历史缓存 3 分钟）
并做一次 200ms 的进程采样，冷启动下首帧往往超过 4 秒。于是同一条命令在「缓存热」时是绿的、
在「缓存冷」时是红的 —— 这不是产品回归，是自检对时序做了错误假设。

更糟的是它会误导排查方向：看到统计页 7 项全红，第一反应会去查页面或接口，
而实际只是等待时间不够。

## Decision

自检改成**轮询等待目标内容出现**（最多 15 秒），而不是猜一个固定的 slept 时长：

```js
async function waitForText(keyword, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const text = await ev('document.body.innerText')
    if (typeof text === 'string' && text.includes(keyword)) return text
    await sleep(500)
  }
  return (await ev('document.body.innerText')) || ''
}
```

超时后返回最后一次文本，让既有的断言照常失败并打印页面内容 —— 超时是「失败」而不是「跳过」，
门禁仍然会因为真问题变红。

## Alternatives considered

- **把 sleep 从 4 秒调到 10 秒**：最省事，但只是把阈值抬高，冷启动更慢的机器还会复现；
  而且每次跑都要白等 10 秒，热缓存时也一样。放弃。
- **给 `/stats` 加缓存或预热门禁**：治的是产品而不是测试，且会让「首屏到底多慢」这件事不可见。放弃。
- **进页面先等网络空闲（Network.idle）**：CDP 上更"正确"，但本项目的 `/stats` 是 `fetch` + 组件内重渲染，
  network idle 早于渲染完成，仍会误判。放弃。
- **直接断言接口而非页面**：会退化成只验 API 不验渲染，违背「界面改动要真看」的原则。放弃。

## Consequences

收益：自检不再受冷/热缓存影响；失败时能看到真实页面内容，排查方向不会跑偏。
成本：最坏情况下单条检查多等几秒（正常路径 1 秒内就返回，因为轮询 500ms 一次）。

顺带暴露了一个更普遍的问题：**这套自检里其它固定 sleep 同样脆弱**（`smoke.mjs` 里也有若干）。
本次只修被 CI 抓到的这一处，其余等实际出现 flake 再改 —— 不做无证据的批量重写。
