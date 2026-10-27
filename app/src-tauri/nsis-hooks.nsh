; LanDeck 安装器钩子：在覆盖文件之前，关闭仍在运行的被控端。
;
; 为什么需要这个：
;   Tauri 生成的 installer.nsi 只在 CheckIfAppIsRunning 里注册了**主程序**
;   ${MAINBINARYNAME}.exe（即 landeck.exe）。resources\landeck-agent.exe
;   是安装包额外拷进去的资源文件，从不参与那个检查。
;   而被控端默认常驻系统托盘（tray.Start），于是安装时它正开着：
;     File /a "/oname=resources\landeck-agent.exe" ...
;   这一步会撞上文件占用，弹出
;     Error opening file for writing: ...\LanDeck\resources\landeck-agent.exe
;   用户只能中止安装。实测复现（安装 10:17 时刻，agent PID 26540 一直在跑）。
;
; 做法：在 NSIS_HOOK_PREINSTALL（拷贝文件之前）用 taskkill 关闭被控端。
;   - taskkill 对它自己的路径做的是「按映像名」匹配，因此无需知道完整路径；
;   - /F 强制结束，避免托盘进程忽略关闭请求；
;   - 用 nsExec 静默执行，不弹出控制台黑框；
;   - 进程本来就没在跑时 taskkill 返回非零，这里刻意忽略该返回值：
;     「没在跑」正是我们想要的状态，不该让安装失败。
;
; 注意：被控端的开机自启登记在 HKCU\...\Run 的 "LanDeckAgent" 项下，
; 只在用户登录时触发，安装过程中不会把进程拉起来，所以杀掉一次即可，
; 不需要额外处理自启项。

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "关闭正在运行的 LanDeck 被控端..."
  nsExec::Exec 'taskkill /F /IM landeck-agent.exe /T'
  Pop $0
  ; $0 == "0" 表示确实杀掉了进程；非 0 表示本来没在跑（正常）。
  ; 两种情况都继续安装。

  DetailPrint "关闭正在运行的 LanDeck 主程序..."
  nsExec::Exec 'taskkill /F /IM landeck.exe /T'
  Pop $0

  ; 给系统一点时间释放文件句柄，否则紧接着的 File 拷贝仍可能撞上占用。
  Sleep 800
!macroend

; 卸载时同样要先把进程关掉，否则删除文件会失败（$INSTDIR\resources 删不干净）。
!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "关闭正在运行的 LanDeck 被控端..."
  nsExec::Exec 'taskkill /F /IM landeck-agent.exe /T'
  Pop $0

  DetailPrint "关闭正在运行的 LanDeck 主程序..."
  nsExec::Exec 'taskkill /F /IM landeck.exe /T'
  Pop $0

  Sleep 800
!macroend