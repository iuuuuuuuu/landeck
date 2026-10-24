# Agent Note: MCP 控制面（AI 可直接操作被控机）

Status: implemented

## Problem

用户后续要求「再加一个 MCP，以后可以让 AI 控制」。这不只是加一个 HTTP 路由：
要决定 AI 能看到哪些能力、危险动作（关机/结束进程）如何表达与撤回、鉴权复用哪套凭据，
以及控制端 UI 与 AI 之间的权限是否一致。

## Decision

Agent 内置 MCP 服务，**与 REST 共用一套令牌与能力开关**，不引入第二套权限模型：

1. **传输**：`POST /mcp`，JSON-RPC 2.0 over HTTP（对应 MCP Streamable HTTP）。
   另提供 stdio 桥 `landeck-agent mcp --token ldk_…`，把 stdin 的 JSON-RPC 逐行转给本机 Agent，
   供 Claude Desktop 这类只支持 stdio 的客户端使用。
2. **鉴权**：`Authorization: Bearer <配对令牌>`，与 REST 完全一致；没有令牌一律 401，
   不做「本机免鉴权」的后门。配对客户端被吊销后，MCP 同一时刻失效。
3. **工具集（10 个）**：`landeck_status`、`landeck_power`、`landeck_volume`、`landeck_media`、
   `landeck_hardware`、`landeck_uptime`、`landeck_schedules`、`landeck_processes`、
   `landeck_kill_process`、`landeck_activity`。
   工具描述写清取值枚举与单位（秒/百分比），返回一律是 `content:[{type:"text",text:"<JSON>"}]`。
4. **危险动作的表达**：电源类工具与 UI 共用同一条 `dispatch` 路径，
   `shutdown/restart` 默认 `delay=5`，AI 可以在 5 秒内用 `op=cancel` 撤销；
   结束进程沿用 UI 的系统关键进程黑名单（system/csrss/wininit/lsass/services/init/systemd/launchd…）。
5. **审计**：每次 MCP 调用都写入 activity 日志，`clientName` 就是发起调用的配对客户端名，
   与手机端操作在同一张时间线里可查。

## Alternatives considered

- **独立 MCP 进程（另一个二进制）**：隔离更好、AI 侧可单独重启；但要多装一个文件、
  多管一份令牌与配置，与「Agent 单文件」的取舍冲突。放弃。
- **stdio-only（不做 HTTP 端点）**：实现最简单，也更符合桌面 MCP 客户端的习惯；
  但手机/浏览器场景无法用，且远程 AI 需要 SSH 隧道。作为桥保留，不作为唯一形态。
- **给 AI 单独开一套更高权限（比如直接执行 shell）**：灵活性最高，但等于把被控机完全交出去，
  与 UI 的能力开关脱节，审计也无法对齐。明确不做；`allowShell` 默认关闭且 MCP 不暴露 shell 工具。
- **要求 AI 侧二次确认（elicitation）**：更安全，但当前 MCP 客户端支持度参差，
  且真正需要确认的是「谁在操作」，最终用 5 秒可撤销窗口 + activity 审计替代。

## Consequences

收益：AI 与手机端走同一套鉴权、同一套动作、同一份审计；一个 `/mcp` 端点即可被任意 MCP 客户端接入。

代价：
- MCP 工具面扩大了攻击面（尤其是 `landeck_kill_process`）。缓解手段是令牌必填、
  关键进程黑名单、`allowProcessKill` 总开关、以及全部操作落日志。
- 关机类操作对 AI 是异步语义（5 秒后执行），模型需要读到 `detail` 才知道已排定；
  `isError` 只表示调用失败，不代表机器真的关了。
- 目前没有做 MCP 的 resources/prompts（返回空列表），能力面只覆盖 tools。
