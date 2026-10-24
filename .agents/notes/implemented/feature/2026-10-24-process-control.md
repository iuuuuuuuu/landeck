# Agent Note: 进程查看与结束进程（含系统关键进程黑名单）

Status: implemented

## Problem

用户追加需求：能查看进程、能结束进程。这是本项目第一个「能直接让被控机出问题」的能力：
杀错进程轻则丢数据，重则蓝屏/注销。同时进程枚举本身很贵（Windows 上 400+ 进程，
每个都要取名字/内存/CPU/用户），不能按 2 秒一次的状态推送去算。

## Decision

1. **接口**：`GET /api/v1/processes?sort=cpu|mem|name|pid&limit&q` 与
   `POST /api/v1/processes/kill {pid|name, force}`；MCP 侧对应
   `landeck_processes` / `landeck_kill_process`。
2. **CPU 采样**：两次遍历进程间隔 200 ms 取差值，得到瞬时占用；结果缓存 2 s。
   gopsutil 在 Windows 返回的是「全核累计百分比」，除以核数归一化成任务管理器口径，
   否则前端会出现 178% 这种数字。首次请求 300–500 ms，前端必须有 loading。
3. **结束进程**：`force=true` 走 `Kill`（TerminateProcess / SIGKILL），`false` 走 `Terminate`。
   只给 `name` 时必须同名唯一，否则要求改用 `pid`——避免把一批 `svchost.exe` 一起杀掉。
4. **黑名单**：`system / system idle process / registry / memory compression / smss.exe /
   csrss.exe / wininit.exe / winlogon.exe / services.exe / lsass.exe / lsaiso.exe / sihost.exe /
   init / systemd / launchd / kernel_task`，命中直接拒绝并回中文原因；PID ≤ 4 与 Agent 自身也拒绝。
5. **总开关**：`features.allowProcessKill`（默认开）。关掉后**查看也一并关闭**（409），
   避免"不能杀但能看"造成的能力误解，也和 settings 页的开关语义一致。
6. **审计**：每次结束进程都写 activity（谁、什么时候、杀了哪个 PID/名字）。

## Alternatives considered

- **只给 PID、不支持按名字杀**：最安全；但手机上记不住 PID，用户体验差。
  折中为「名字唯一才允许」。
- **自己做进程树/父子联动杀（杀父带子）**：更符合"关掉一个应用"的直觉；
  但误伤风险陡增，且跨平台父子关系语义不一致。不做，留给用户按 PID 精确处理。
- **实时流式进程列表（WS 推送）**：观感最好；但 400 个进程每秒变化，
  推送体积与 CPU 代价都不划算。改为面板可见时 15 s 轮询 + 手动刷新。
- **允许结束任何进程（含系统关键进程）**：能力最完整；但一次误操作就能让机器蓝屏，
  且远程操作者看不到报错，只能等机器没了。明确加黑名单。

## Consequences

收益：能在手机上定位"谁吃满了内存"并直接处理；CPU% 与任务管理器口径一致，不会误判；
危险操作有黑名单 + 审计 + 总开关三道闸。

代价：
- 两次采样意味着首次列表有 300–500 ms 延迟，且会短暂占用一点 CPU（约 1% 持续 200 ms）。
- 黑名单是硬编码的，遇到新的系统关键进程（或 Linux 的 kthreadd 之类）需要补；
  目前宁可少杀，也不放开。
- `Terminate`（非 force）在 Windows 上对无窗口进程基本等于强杀，"优雅退出"只对部分应用成立，
  UI 里已用文案说明会丢未保存数据。
