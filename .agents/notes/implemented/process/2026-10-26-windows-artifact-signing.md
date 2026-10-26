# Agent Note: Windows 产物签名链路（自签名证书 + Tauri signCommand + 真门禁）

Status: implemented

## Problem

用户反复看到 Windows 的「安全警告 / 未知发布者」提示（对话框文案含
「来自 Internet 的文件可能对你有所帮助」），并要求「给消除掉」。

排查后发现，这个问题**不存在单一根因，而是四个各自独立的缺陷叠在一起**，
其中三个是我自己在前几轮引入或误判的：

1. **签错了对象**。快捷方式（桌面 / 开始菜单 / Startup 三处）全部指向
   `%LOCALAPPDATA%\LanDeck\landeck.exe`，即安装后的副本；而脚本只签
   `target\release\landeck.exe` 与 `bundle\nsis\*.exe`。
   实测：安装副本 `landeck.exe` / `uninstall.exe` / `resources\landeck-agent.exe`
   三者在修复前全为 `NotSigned`。**签了等于没签。**
2. **打包期完全没有签名**。`tauri.conf.json` 的 `bundle.windows` 是 `{}`，
   从未配过 `certificateThumbprint` / `signCommand`，所以每次 `tauri build`
   产出的安装包天然是未签名的。
3. **假绿**。第一版脚本用 `Set-AuthenticodeSignature` 的返回值判断成败并报
   `ok=N`，但证书当时根本没进存储；`build.sh` 又用
   `powershell.exe -File ... 2>/dev/null || echo "（跳过签名）"`
   把真实错误吞掉并伪装成「正常跳过」。
4. **弹窗归属被误判**。我先前两轮把它说成 SmartScreen 信誉问题，后来又改口
   说成 MOTW。实测两条都不成立：

   - **MOTW 不存在**。用 `EnumAllStreams` 与 `dir /r` 双重核对，所有产物
     （构建产物、安装包、桌面副本、下载目录里的旧包）**均无** `Zone.Identifier` 流。
   - **不是火绒**。火绒 6.0.0.2 确实在运行（`HipsTray` / `HipsDaemon` / `HRWSCCtrl`），
     但 `hipsdaemon.log`、`hips.db`、`appdb.db`、`user.db` 里 grep `landeck`
     **零命中**，排除其拦截弹窗。
   - **是 Windows 自己的框**。把该系统上 2027 个 MUI/DLL 逐个做字符串比对，
     那批文案（「来自 Internet 的文件」「未知发布者」「安全警告」
     「Internet 的文件可能」）**只命中 `ieframe.dll.mui` 与 `shdocvw.dll.mui`** ——
     即 IE/Shell 的「打开文件 - 安全警告」对话框，归属确定。

## Decision

1. **签「真正会被点开的那一个」**：`tools/sign-windows.ps1` 的默认目标集合加入
   `%LOCALAPPDATA%\LanDeck`（安装副本所在目录），并对该目录下的
   `landeck.exe` / `uninstall.exe` / `resources\landeck-agent.exe` 实签名。
   证书写入 `CurrentUser\Root` + `CurrentUser\TrustedPublisher` 后**重新打开存储复读校验**
   （写回执不算数——这正是第 3 条假绿的成因）。
2. **打包期签名用 `signCommand`，不用 `certificateThumbprint`**：
   本机没有 `signtool.exe`（`KitsRoot10` 指向 `D:\Windows Kits\10\`，其下无
   `bin\*\x64\signtool.exe`），`certificateThumbprint` 路径必然失败。
   `signCommand` 走 PowerShell，不依赖 SDK。
   该配置**放在 `app/src-tauri/tauri.windows.conf.json` 这个平台专属文件里**，
   不放进主 `tauri.conf.json`：Tauri 会把平台专属配置与主配置合并，而
   `signCommand` 一旦出现在主配置里，Linux / macOS 的 CI 打包也会去执行
   `powershell.exe`（那些 runner 上没有该程序），会把 CI 直接搞红。
   实测：`bundle.windows` 在主配置中为 `{}`，Windows 构建时合并后仍含
   `signCommand` 并确实执行（日志 `Signing … with a custom signing command`）。
3. **`signCommand` 的路径必须 `../../tools/sign-one.ps1`**（注意是**两层**）。
   实测探针构建记录到 Tauri 调用 `signCommand` 时的
   cwd = `<repo>\app\src-tauri`（不是 `app`），且 Tauri 源码
   `sign_command_custom` 只在 `path.exists() && path.is_relative()` 时才把相对路径
   重写为绝对路径 —— 写错会**原样透传**并以
   `The argument '...' to the -File parameter does not exist` 中断整次打包。
   连续两次失败（一次 `../tools/…`、一次探针用绝对路径）都是这条规则。
4. **`signCommand` 必须带产物白名单**。Tauri 把**每一个可签名二进制**都推给该命令，
   包括它自带的 WiX 工具链 DLL：
   `target\release\wix\x64\wix\WixUIExtension.dll`、`WixUtilExtension.dll`。
   用本地证书去签第三方工具链，既是错的，也会污染 Tauri 的工具缓存。
   `sign-one.ps1` 因此加 `-NamePattern 'landeck|LanDeck'`，不匹配则打印
   `skip (not our artifact)` 并 exit 0。
5. **验收只看复读结果**：`sign-one.ps1` 签完后重新 `Get-AuthenticodeSignature`，
   同时校验 `Status = Valid` **且** 指纹与证书一致，两者都满足才 exit 0。
   并做**故障注入**证明门禁会变红（见下）。
6. **`build.sh` 不再吞错**：去掉 `2>/dev/null || echo "（跳过签名）"`，
   签名失败即让构建 `exit` 非零。

## Alternatives considered

- **买商业代码签名证书（OV/EV）**：这是唯一能让**别人**也不弹框的正路，
  也是自签名做不到的部分。但需要花钱（约 ¥1000–4000/年）与企业资质，
  超出本次「让本机不弹」的请求范围。**列为后续可选项，未实施。**
- **只签构建产物、不签安装副本**：改动最小，但用户点开的正是安装副本，
  实测无效。放弃（这正是第 1 条缺陷）。
- **用 `certificateThumbprint` + `digestAlgorithm`**：Tauri 的官方推荐写法，
  但对本机不成立 —— 没有 `signtool.exe`，配置完必定在打包末尾报
  `SignToolNotFound`。放弃。
- **把 `signCommand` 写成内联 `-Command`**：试过。`%1` 只在**参数恰好等于 `%1`**时
  被替换，内嵌进命令文本无效；`-Command` 后面也无法再跟位置参数
  （PowerShell 解析器会把它拼进命令行文本并报 `Unexpected token`）。放弃。
- **干脆不管 MSI**：`light.exe` 在 `TEMP=C:\Users\IUUUUU~1\AppData\Local\Temp`
  下报 `LGHT0001 对路径 … 的访问被拒绝`，且**单独运行 `light.exe` 也报同一错、
  与本次改动无关**（在 `WriteAllText` 到同一目录成功的前提下仍失败）。
  MSI 是次生产物，本次预测试版用 `tauri build --bundles nsis` 绕开；
  WiX 的环境问题单独立项，不混进这次改动。放弃在本轮修它。

## Consequences

收益：安装副本与打包产物都带本机信任的签名，发行商显示为
`LanDeck (本地自签名)`；打包期签名不再靠人工记得跑脚本；
签名失败会在构建期直接变红，不再被 `|| echo` 掩盖。

代价与边界：
- **自签名只对本机/本用户生效**。别人拿到包仍会看到「未知发布者」——
  这一点在脚本注释与文档里写明，不假装治好了。
- `signCommand` 会让打包过程多出十余次 PowerShell 进程（每个可签名二进制一次），
  Windows 打包耗时略有增加；非 Windows 平台不受影响。
- **`target\release\landeck.exe` 在打包结束后会变回 `NotSigned`**：Tauri 先把该
  exe 签上、再把它打进安装包，随后打包流程又用未签名版本覆写了这个路径上的文件。
  因此**安装包内嵌的那份是签名的**（解包实测 3632736 字节、`Valid`），
  而目录里残留的那份需要补签 —— 直接双击开发产物的人看到的正是这一份。
  `tools/sign-windows.ps1` 的默认目标集合同时覆盖两者。
- 白名单靠文件名正则，若将来产物改名（例如不再含 `landeck`），
  会静默变成 `skip` 而不再签名。改名时需同步 `-NamePattern`。
- WiX/MSI 在本机仍不可用（既有环境问题），本轮未修。

## Testing

门禁不能只看「跑通了」，必须能真的变红，因此做了正反两向实测：

- 正向：`sign-one.ps1` 对 `landeck.exe` 输出 `OK (timestamped)`；
  在**独立的新 PowerShell 进程**里复读，`status=Valid` 且
  `thumb=9CDEFB926986D3BB57911A03E70FBDF8773032C2` 与证书一致。
- 反向 1：`-SubjectMatch NoSuchSubjectXYZ` → 打印 `SKIP`，exit **0**（显式跳过，不假装成功）。
- 反向 2：`-SubjectMatch NoSuchSubjectXYZ -Require` → exit **1**（真失败）。
- 反向 3：`-Path C:\nonexistent\no.exe` → `file not found`，exit **1**。
- 白名单：构建日志中 `WixUIExtension.dll` / `WixUtilExtension.dll` 均为
  `skip (not our artifact)`；随后复查这两个 DLL 仍为 `NotSigned`，确认未被误签。
- 端到端：`tauri build --bundles nsis` 日志显示
  `Signing … with a custom signing command` → `sign-one: OK landeck.exe (timestamped)`。