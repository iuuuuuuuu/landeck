; LanDeck 安装钩子：修正 Windows 防火墙放行规则。
;
; 背景（实测踩到）：Windows 会按**程序路径**自动生成防火墙规则。用户曾经在
; 系统弹窗上点过"取消"，或者程序换过安装路径，就会留下一条 **Block** 规则。
; Windows 的显式 Block **优先于 Allow**，于是手机/其它设备连 8420/8421 全部超时，
; 表现是"扫描不到 PC""配对提示设备无响应"，而本机浏览器用 127.0.0.1 一切正常 ——
; 极难自行排查。
;
; 安装程序本身是管理员权限，所以在这里把历史 Block 规则清掉并按路径重新放行。
; 只处理 LanDeck 自己的程序，不动其它软件。

!macro NSIS_HOOK_POSTINSTALL
  ; 1) 删除所有名为 landeck-* 的入站规则（含历史遗留的 Block）
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="landeck-agent.exe"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="landeck-agent"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="landeck-tray"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="landeck-agent-windows-amd64"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="landeck-agent-windows-amd64-console"'

  ; 2) 按安装后的真实路径放行（TCP 8420 控制、UDP 8421 发现）
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="LanDeck Agent (TCP)" dir=in action=allow program="$INSTDIR\resources\landeck-agent.exe" protocol=TCP localport=8420 profile=any enable=yes'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="LanDeck Agent (UDP)" dir=in action=allow program="$INSTDIR\resources\landeck-agent.exe" protocol=UDP localport=8421 profile=any enable=yes'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="LanDeck Agent (HTTPS)" dir=in action=allow program="$INSTDIR\resources\landeck-agent.exe" protocol=TCP localport=8443 profile=any enable=yes'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="LanDeck Agent (TCP)"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="LanDeck Agent (UDP)"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="LanDeck Agent (HTTPS)"'
!macroend
