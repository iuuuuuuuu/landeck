# Agent Note: NSIS 安装器两处缺陷（关闭常驻被控端、%TEMP% 条目数上限）

Status: implemented

## Problem

用户安装 1.0.12/1.0.13 时报两个**不同**的错，看起来无关，实际是两条独立成因：

1. `LanDeck Setup ... Error opening file for writing:
   C:\Users\...\AppData\Local\LanDeck\resources\landeck-agent.exe`，
   用户只能中止安装。
2. 后来变成 `NSIS Error: Error writing temporary file. Make sure your temp folder is valid.`

### 成因一：Tauri 的安装器不检查被控端

Tauri 生成的 `installer.nsi` 在拷贝文件前只调用一次
`!insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"`
（安装段第 682 行），即**只检查主程序 `landeck.exe`**。

而被控端 `resources\landeck-agent.exe` 默认常驻系统托盘（`tray.Start`，
见 `agent/main.go`），是安装包额外拷进去的资源文件，**从不参与那个检查**。
于是安装时它正开着，`File /a "/oname=resources\landeck-agent.exe" ...`
撞上文件占用 → 弹上面的对话框。

实测复现：安装时刻 `landeck-agent.exe` PID 26540 一直在跑；
对目标文件做独占打开返回
`The process cannot access the file ... because it is being used by another process`。

### 成因二：%TEMP% 条目数把 NSIS 自解压压垮

用户机器的 `%TEMP%` 里堆了 **41,820** 个条目（37,398 个目录 / 4,387 个文件），
其中 `sourin` 前缀 10,205 个、`cr` 2,024、`com` 1,982、`ai` 980；
`>7 天` 的有 14,284 个。NSIS 自解压在 `%TEMP%` 下随机建目录，
在这么大的命名空间里拿不到可用名字，于是在**解压阶段**就报
`Error writing temporary file`——注意这条错误与主程序是否运行无关，
所以此时成因一的钩子根本没机会执行。

实测因果（交错 A/B，各 3 轮）：

| `%TEMP%` | 结果 |
| --- | --- |
| 真实 TEMP（41,820 条目） | `exit=2` 失败 ×3 |
| 干净 TEMP | `exit=0` 成功 ×3 |

同一故障也解释了另一件事：WiX `light.exe` 报
`LGHT0001 对路径 C:\Users\...\Temp\xxxxxxxx.tmp 的访问被拒绝`
是同一个根因（临时目录不可用），与签名改动无关。

## Decision

1. **补上被控端的关闭动作**：新增 `app/src-tauri/nsis-hooks.nsh`，
   用 Tauri 官方的 `installerHooks` 机制实现
   `NSIS_HOOK_PREINSTALL` / `NSIS_HOOK_PREUNINSTALL`，
   在拷贝文件之前用 `nsExec::Exec 'taskkill /F /IM landeck-agent.exe /T'`
   关掉被控端，再 `Sleep 800` 给系统释放句柄的时间。

   `taskkill` 返回非零表示「本来就没在跑」，那正是期望状态，
   因此**刻意忽略其返回值**，不让安装失败。

2. **接线放在平台专属配置**：`app/src-tauri/tauri.windows.conf.json` 里
   `bundle.windows.nsis.installerHooks = "nsis-hooks.nsh"`。
   实测 Tauri 会渲染成 `installer.nsi` 第 33 行的
   `!include "D:\...\app\src-tauri\nsis-hooks.nsh"`，
   说明钩子确实被编译进安装包（不是只在配置里写了名字）。

3. **不硬删用户的 `%TEMP%`**：清理是**用户侧**的一次性动作。
   工具本身只清理 `>7 天` 的条目，且只删自己创建的探针目录，
   不对 `%TEMP%` 做无条件清空。会话中为定位问题一度搬动过用户的
   `%TEMP%` 内容，事后全部搬回（无文件丢失），但那是不该做的动作——
   正确做法是用**干净 TEMP** 做 A/B，完全不碰用户目录。

## Alternatives considered

- **让主程序自己退出**（`landeck.exe` 侧监听更新信号）：安装器还没到
  `RunAsUser` 阶段就被文件占用卡住，主程序无从知道要退出。放弃。
- **把被控端改名或放到随机路径**：绕开占用，但会让用户数据目录、
  自启项、防火墙规则全部失去稳定路径，代价远大于收益。放弃。
- **卸载/安装前让用户手动退出托盘**：把机械动作推给人，用户已经在
  安装流程里，多一步必然被漏掉。放弃。
- **在 `installer.nsi` 里给 `CheckIfAppIsRunning` 传两个路径**：该宏的签名
  是单文件（`RestartManager_RegisterFile` 单次注册），Tauri 模板由
  handlebars 生成、上游维护，改模板等于 fork，后续升级会冲突。放弃。
- **用 `WIX_TEMP` / 修改 NSIS 的临时目录**：NSIS 自解压的目录选择由
  stub 内部决定，安装包侧没有可用开关；保证 `%TEMP%` 健康才是可控项。放弃。
- **直接清空用户 `%TEMP%`**：可能删掉其他程序正在使用的临时文件，
  属越界破坏。改为只清 `>7 天` + 只清自己的探针残留。放弃。

## Consequences

收益：带钩子的安装包在**被控端运行中**也能装成功（实测 1.0.13 关闭了
PID 11764 的 agent，1.0.12 无钩子则让 PID 2140 存活）；
`%TEMP%` 清理后本机恢复可安装。

代价与边界：
- 钩子按**映像名**关闭 `landeck-agent.exe`，若用户把它改名运行，
  钩子就匹配不到，占用问题会回来。
- 「先关后装」意味着更新时被控端会话会被中断（用户需重新打开控制台）。
  这是可接受代价：托盘程序本来就不该在更新过程中被覆盖。
- `%TEMP%` 条目数上限**未测出精确阈值**：2000 条目可过、41,820 不可过，
  中间未逐点二分。因此清理策略取保守的 `>7 天`，不承诺某个具体数字。
- 钩子在**解压阶段就失败**的情况下依然没机会执行，
  所以 `%TEMP%` 健康仍是安装成功的前置条件。

## Testing

- 钩子接线：`installer.nsi` 第 33 行确含
  `!include "D:\...\nsis-hooks.nsh"`，且第 678-680 行是
  `!ifmacrodef NSIS_HOOK_PREINSTALL` → `!insertmacro`。
- **对照实验（决定性）**：同样在 `%TEMP%` 已清理、agent 正在运行的条件下，
  分别装 1.0.12（无钩子）与 1.0.13（有钩子）：
  - 1.0.12：安装前 agent `pid=2140`，安装后**仍是 `pid=2140`**（存活）→ 无钩子。
  - 1.0.13：安装前 agent `pid=11764`，安装后**进程已不存在** → 钩子生效。
  两者唯一差异就是钩子，因此可排除「agent 自己退出」的解释。
- 端到端：干净 TEMP 下 `1.0.13 /S` 返回 `exit=0`，
  安装副本 `resources\landeck-agent.exe` 变为新 payload `14794240` 字节，
  注册表版本变为 `1.0.13`。
- `%TEMP%` 因果：交错 A/B 各 3 轮，真实 TEMP `exit=2` ×3、干净 TEMP `exit=0` ×3。
- `%TEMP%` 清理：删除 14,266 项（85.7 MB），47 项因被占用跳过（未强删），
  条目数 42,115 → 27,860。