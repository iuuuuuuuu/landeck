# Agent Note: A2 域名记录 agent 侧落地（/activity/domain + 内存表 + 域名分类）

Status: implemented

## Problem

按 proposed 笔记 3b03f3b 的调研结论落地 agent 侧：MV3 扩展 companion
（web-rd 批）通过 localhost 推送浏览器激活标签域名，agent 用它参与
「浏览器前台时段」的分类（YouTube→影音），domainCapture 默认关。

## Decision

1. **POST /api/v1/activity/domain**（httpapi/domain.go）：
   - 501 门：domainCapture=false 直接 501 且优先于鉴权（不留暧昧端点，
     连鉴权都不做——有专门断言）
   - 仅回环：严格 127.0.0.1/::1（比 isLocalRequest 更严——本机网卡 IP
     也拒，远程设备伪造内网源 IP 的攻击面归零）
   - 双模式鉴权（settings.domainAuth，默认 "token"）：
     "token" = bearer/?token=，走 Authenticate（pairing.json 令牌口径）；
     "origin" = Origin 头 ∈ settings.DomainOrigins（trim+小写+去尾斜杠归一）
   - body 16KB 上限；browser 白名单 chrome|edge|firefox；domain 必填
2. **内存最近域名表**（activity/domains.go）：browser→{domain,title,At}；
   有效期 = max(60s, 2×intervalSec)；domain 净化（URL→裸主机名、去端口、
   小写；localhost/无点主机名拒收）。重启丢失无妨——扩展下次标签切换即补。
3. **分类接入（契约调和点，见 Consequences 声明）**：段上快照 domain
   （segments 新列，ALTER 漂移容忍迁移，老段空=回退标题分类）。
   tick 时从内存表取（Keep 分支延续旧快照，extend 顺带更新 domain——
   SPA 换页标题不变的场景也能跟上）；Classify 加 domain 参数，
   域名命中优先于 app/title 规则。
4. **匹配器刻意收紧**：DomainPatterns 用「精确等值 + *.pattern 后缀」，
   不用 title 的 containsFold——"notyoutube.com.evil" 子串误报对域名是
   真实风险（有专门测试）。
5. 设置：domainCapture（默认 false）/ domainAuth（默认 token）/
   domainOrigins，PUT 部分更新语义不变，sanitize 归一。

## Alternatives considered

- **分类在 tick 时预计算落库（不存 domain）**：破坏「读取时分类、规则编辑
  追溯应用」的一期架构——用户改域名规则应能追溯历史。放弃。
- **DomainPatterns 用 containsFold（title 同款）**：误报风险见上。放弃，
  收紧为等值+后缀。
- **501 时仍校验鉴权**：契约说「不留暧昧端点」——先 501 再说，有测试锁住
  顺序（关闭态无 token 也 501）。
- **isLocalRequest 复用**：它放行本机网卡 IP；契约写「仅回环 127.0.0.1」，
  从严实现。放弃复用。

## Consequences

收益（全部有测试）：

- 纯函数：matchDomain（youtube.com/www.youtube.com/music.youtube.com ✓、
  youtu.be 独立规则、notyoutube.com/youtube.com.evil.cn 误报防线、大小写归一、
  空 pattern）；normalizeDomain（URL/裸域名/端口/localhost 拒收）；
  Classify 域名优先级三态（命中/无域名回退/未命中回退）
- 内存表联动：SetDomain→DomainFor、白名单外忽略、过期不返回、空上报不覆盖
- httpapi：token 200/401（走真实 Pair 流程拿令牌——SetFixedKey 要求 8 位
  归一口径，顺带发现 FixedKey 不在 Authenticate 链路里）、非回环 403、
  关闭 501（含顺序断言）、origin 白名单放行/拒绝/模式切换、body 校验三例
- 故障注入：token 校验失效（条件恒假，可编译版）→ TestDomainTokenReject
  精确变红，恢复绿
- 全仓 build/vet/test 7 包绿

代价与边界：

- **契约调和声明**：契约 2 说内存表「不落库」（指最近域名表本身），契约 5
  要求域名影响历史段分类——本仓库是读取时分类，因此段上必须有 domain 快照
  （新列+迁移）。这是两条契约的调和而非偏差；domain 值本身仍只来自内存表
- 域名表 30s-2min 过期窗口内的归类可能短暂滞后于用户实际所在站点
  （扩展事件推送的间隔决定精度）
- domainCapture 关闭时存量 domain 快照仍在库里参与分类（开关只管上报门）——
  历史分类仍可追溯；如需「关闭即忽略域名」的读取侧开关，v2 再议
- origin 模式的白名单是运维手工配置（settings PUT），商店上架前的 token 模式
  不受影响

## Testing

- 见 Consequences 的测试清单；全部走真实组件（Pair 流程、SQLite 迁移、
  httptest 直调 handler）
- 中途踩的坑：SetFixedKey 要求归一后 9 字符（8 位+自动连字符），
  FixedKey 不在 Authenticate 链路——测试改走真实 Pair
- Classify 签名变更波及 rules_test/store_test/perf_test 调用点（正则批量 +
  逐处核对）
