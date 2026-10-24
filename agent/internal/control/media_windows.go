//go:build windows

package control

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Windows 媒体状态走 SMTC（System Media Transport Controls）。
// 用 PowerShell 常驻子进程承载 WinRT 调用：一次性加载类型，之后每次查询 20–80ms。
// 直接 keybd_event 只能发键、拿不到"当前在播什么/是否播放中"，所以状态与控制都走 SMTC，
// 失败时才回退到媒体键。

const smtcScript = `# LanDeck SMTC helper: read a command line from stdin, write one JSON line to stdout
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ready = $false
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  $script:asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'
  })[0]
  # WinRT types need the ContentType=WindowsRuntime suffix to resolve here
  $script:mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
  $script:propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
  $ready = $true
} catch {
  $ready = $false
}

function Await($op, $type) {
  $asTask = $script:asTaskGeneric.MakeGenericMethod($type)
  $task = $asTask.Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}

function Emit($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 4
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $cmd = $line.Trim()
  if ($cmd -eq '') { continue }
  if (-not $ready) { Emit @{ ok = $false; error = 'winrt_unavailable' }; continue }

  try {
    $mgr = Await ($script:mgrType::RequestAsync()) $script:mgrType
    if ($null -eq $mgr) { Emit @{ ok = $false; error = 'no_manager' }; continue }
    $session = $mgr.GetCurrentSession()
    if ($null -eq $session) { Emit @{ ok = $true; active = $false }; continue }

    switch ($cmd) {
      'state' {
        $p = Await ($session.TryGetMediaPropertiesAsync()) $script:propsType
        $info = $session.GetPlaybackInfo()
        $tl = $session.GetTimelineProperties()
        Emit @{
          ok       = $true
          active   = $true
          playing  = ($info.PlaybackStatus.ToString() -eq 'Playing')
          status   = $info.PlaybackStatus.ToString()
          title    = $p.Title
          artist   = $p.Artist
          album    = $p.AlbumTitle
          app      = $session.SourceAppUserModelId
          position = [double]$tl.Position.TotalSeconds
          duration = [double]$tl.EndTime.TotalSeconds
          updated  = [double]($tl.LastUpdatedTime.ToUnixTimeMilliseconds() / 1000)
        }
      }
      'play_pause' { $r = Await ($session.TryTogglePlayPauseAsync()) ([bool]); Emit @{ ok = $true; result = [bool]$r } }
      'next'       { $r = Await ($session.TrySkipNextAsync()) ([bool]);        Emit @{ ok = $true; result = [bool]$r } }
      'prev'       { $r = Await ($session.TrySkipPreviousAsync()) ([bool]);    Emit @{ ok = $true; result = [bool]$r } }
      'stop'       { $r = Await ($session.TryPauseAsync()) ([bool]);           Emit @{ ok = $true; result = [bool]$r } }
      default      { Emit @{ ok = $false; error = 'unknown_cmd' } }
    }
  } catch {
    Emit @{ ok = $false; error = "$($_.Exception.Message)" }
  }
}
`

type smtcHelper struct {
	mu   sync.Mutex
	cmd  *exec.Cmd
	in   io.WriteCloser
	out  *bufio.Reader
	path string
	warn bool
}

func newSMTC(dataDir string) *smtcHelper {
	return &smtcHelper{path: filepath.Join(dataDir, "smtc-helper.ps1")}
}

func (h *smtcHelper) start() error {
	if h.cmd != nil {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(h.path), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(h.path, append([]byte{0xEF, 0xBB, 0xBF}, []byte(smtcScript)...), 0o600); err != nil {
		return err
	}
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", h.path)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	in, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return err
	}
	h.cmd = cmd
	h.in = in
	h.out = bufio.NewReaderSize(out, 64*1024)
	return nil
}

func (h *smtcHelper) stop() {
	if h.cmd == nil {
		return
	}
	_ = h.in.Close()
	_ = h.cmd.Process.Kill()
	_, _ = h.cmd.Process.Wait()
	h.cmd = nil
	h.in = nil
	h.out = nil
}

// call 发一条命令并等一行 JSON。超时 2s，失败即重启助手。
func (h *smtcHelper) call(cmds string) (map[string]any, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if err := h.start(); err != nil {
		return nil, err
	}
	if _, err := io.WriteString(h.in, cmds+"\n"); err != nil {
		h.stop()
		return nil, err
	}

	type result struct {
		line string
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		line, err := h.out.ReadString('\n')
		ch <- result{line: line, err: err}
	}()
	select {
	case r := <-ch:
		if r.err != nil {
			h.stop()
			return nil, r.err
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(strings.TrimSpace(r.line)), &m); err != nil {
			h.stop()
			return nil, fmt.Errorf("解析 SMTC 输出失败: %w (%s)", err, strings.TrimSpace(r.line))
		}
		if ok, _ := m["ok"].(bool); !ok {
			return nil, fmt.Errorf("smtc: %v", m["error"])
		}
		return m, nil
	case <-time.After(3 * time.Second):
		h.stop() // 卡死就重启，下次调用会拉起新进程
		return nil, fmt.Errorf("SMTC 超时")
	}
}

// readMediaState 返回当前媒体状态；没有活动会话时 active=false。
func (h *smtcHelper) readMediaState() (MediaInfo, error) {
	m, err := h.call("state")
	if err != nil {
		return MediaInfo{}, err
	}
	active, _ := m["active"].(bool)
	if !active {
		return MediaInfo{Known: true, Active: false}, nil
	}
	info := MediaInfo{Known: true, Active: true}
	info.Playing, _ = m["playing"].(bool)
	info.Title, _ = m["title"].(string)
	info.Artist, _ = m["artist"].(string)
	info.Album, _ = m["album"].(string)
	info.App, _ = m["app"].(string)
	info.Status, _ = m["status"].(string)
	info.PositionSec, _ = m["position"].(float64)
	info.DurationSec, _ = m["duration"].(float64)
	info.UpdatedAt, _ = m["updated"].(float64)
	info.App = prettyAppName(info.App)
	return info, nil
}

func prettyAppName(id string) string {
	low := strings.ToLower(id)
	switch {
	case strings.Contains(low, "spotify"):
		return "Spotify"
	case strings.Contains(low, "chrome"):
		return "Chrome"
	case strings.Contains(low, "msedge"):
		return "Edge"
	case strings.Contains(low, "firefox"):
		return "Firefox"
	case strings.Contains(low, "zunemusic") || strings.Contains(low, "mediaplayer"):
		return "媒体播放器"
	case strings.Contains(low, "qqmusic"):
		return "QQ 音乐"
	case strings.Contains(low, "cloudmusic") || strings.Contains(low, "netease"):
		return "网易云音乐"
	case strings.Contains(low, "kugou"):
		return "酷狗"
	case strings.Contains(low, "potplayer"):
		return "PotPlayer"
	case strings.Contains(id, "!"):
		// 形如 "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"
		parts := strings.Split(id, "!")
		base := strings.Split(parts[len(parts)-1], ".")[0]
		if base != "" {
			return base
		}
	}
	if id == "" {
		return "系统媒体"
	}
	return id
}

// mediaByKeys 是 SMTC 不可用时的兜底：只发媒体键，拿不到状态。
func (c *windowsController) mediaByKeys(op string) error {
	vk, ok := mediaKeys[op]
	if !ok {
		return ErrUnsupported
	}
	procKeybdEvent.Call(uintptr(vk), 0, 0, 0)
	procKeybdEvent.Call(uintptr(vk), 0, keyeventfKeyup, 0)
	return nil
}

var _ = strconv.Itoa
