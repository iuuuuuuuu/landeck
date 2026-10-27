package httpapi

import (
	"encoding/json"
	"log"
	"errors"
	"fmt"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/host"

	"landeck/internal/auth"
	"landeck/internal/config"
	"landeck/internal/control"
	"landeck/internal/discovery"
	"landeck/internal/metrics"
	"landeck/internal/scheduler"
)

func (s *Server) features() map[string]bool {
	caps := s.Ctrl.Caps()
	cfg := s.Cfg.Get()
	return map[string]bool{
		"power":     true,
		"media":     caps.Media,
		"volume":    caps.Volume,
		"wol":       cfg.Features.AllowWol,
		"schedules": cfg.Features.AllowSchedules,
		"hardware":  true,
		"shell":     cfg.Features.AllowShell,
		"processes": cfg.Features.AllowProcessKill,
		"files":     cfg.Files.Enabled,
		"battery":   false,
	}
}

func (s *Server) node(paired bool) discovery.Node {
	cfg := s.Cfg.Get()
	return discovery.Node{
		V: 1, ID: cfg.DeviceID, Name: cfg.DeviceName, Port: effectivePort(cfg),
		TLS: cfg.TLS.Enabled, Ver: s.Version, OS: runtime.GOOS, Arch: runtime.GOARCH,
		Paired: paired,
	}
}

func effectivePort(cfg config.Config) int {
	if cfg.Port <= 0 {
		return config.DefaultPort
	}
	return cfg.Port
}

// GET /api/v1/hello —— 无鉴权，供发现与配对前握手
func (s *Server) handleHello(w http.ResponseWriter, r *http.Request) {
	cfg := s.Cfg.Get()
	code, exp := s.Auth.Code()
	node := s.node(len(cfg.Clients) > 0)
	node.IP = localAddrFor(r)
	// isSelf：请求来自本机（loopback 或本机网卡地址）时为真。
	// 前端据此把「自己」标出来并直接免配对进入，不需要用户给自己再配一次。
	isSelf := isLocalRequest(r)
	writeJSON(w, http.StatusOK, struct {
		discovery.Node
		Pairing map[string]any `json:"pairing"`
		Self    bool           `json:"self"`
	}{
		Node: node,
		Self: isSelf,
		Pairing: map[string]any{
			"fixed":         cfg.FixedKey != "",
			"random":        cfg.RandomEnabled,
			"codeExpiresAt": exp.Format(time.RFC3339),
			"code":          maskCode(code, cfg.RandomEnabled),
		},
	})
}

// maskCode：未配对时也把随机码吐出来会破坏"只在本机看"的安全模型，故只在 loopback 访问时返回。
func maskCode(code string, enabled bool) string {
	if !enabled {
		return ""
	}
	return ""
}

func localAddrFor(r *http.Request) string {
	host, _, err := netSplitHostPort(r.Host)
	if err != nil {
		return ""
	}
	if host == "localhost" || host == "127.0.0.1" {
		return host
	}
	return host
}

func netSplitHostPort(hp string) (string, string, error) {
	i := strings.LastIndex(hp, ":")
	if i < 0 {
		return hp, "", nil
	}
	return hp[:i], hp[i+1:], nil
}

type pairReq struct {
	Key        string `json:"key"`
	Kind       string `json:"kind"`
	ClientName string `json:"clientName"`
	ClientID   string `json:"clientId"`
}

func (s *Server) handlePair(w http.ResponseWriter, r *http.Request) {
	var req pairReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "请求格式不正确")
		return
	}
	res, err := s.Auth.Pair(clientIP(r), req.ClientName, req.ClientID, req.Key, req.Kind)
	switch {
	case errors.Is(err, auth.ErrRateLimited):
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "尝试过于频繁，请 1 分钟后再试")
		return
	case errors.Is(err, auth.ErrInvalidKey):
		writeErr(w, http.StatusUnauthorized, "invalid_key", "密钥不正确或已过期")
		return
	case errors.Is(err, auth.ErrBadRequest):
		writeErr(w, http.StatusBadRequest, "bad_request", "未知的密钥类型")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	cfg := s.Cfg.Get()
	s.Acts.Add(store_activity("配对成功", res.ClientName, true, "来自 "+clientIP(r)))
	writeJSON(w, http.StatusOK, map[string]any{
		"token":      res.Token,
		"clientId":   res.ClientID,
		"clientName": res.ClientName,
		"role":       res.Role,
		"server": map[string]any{
			"id": cfg.DeviceID, "name": cfg.DeviceName, "port": effectivePort(cfg),
			"tls": cfg.TLS.Enabled, "ver": s.Version,
		},
	})
}

func (s *Server) handleSession(w http.ResponseWriter, r *http.Request, c *config.Client) {
	writeJSON(w, http.StatusOK, map[string]any{
		"clientId": c.ID, "clientName": c.Name, "role": c.Role,
		"createdAt": c.CreatedAt.Format(time.RFC3339),
		"lastSeenAt": c.LastSeenAt.Format(time.RFC3339),
	})
}

func (s *Server) handleSystem(w http.ResponseWriter, r *http.Request, c *config.Client) {
	cfg := s.Cfg.Get()
	info, _ := host.Info()
	name := cfg.DeviceName
	kernel := ""
	osName := runtime.GOOS
	if info != nil {
		kernel = info.KernelVersion
		switch runtime.GOOS {
		case "windows":
			osName = "Windows " + info.PlatformVersion
		case "darwin":
			osName = "macOS " + info.PlatformVersion
		default:
			osName = info.Platform + " " + info.PlatformVersion
		}
		if name == "" {
			name = info.Hostname
		}
	}
	caps := s.Ctrl.Caps()
	uptime, bootTime := uint64(0), ""
	if info != nil {
		uptime = info.Uptime
		bootTime = time.Unix(int64(info.BootTime), 0).Format(time.RFC3339)
	}
	f := s.features()
	f["battery"] = false
	writeJSON(w, http.StatusOK, map[string]any{
		"id": cfg.DeviceID, "name": name, "hostname": hostname(),
		"os": strings.TrimSpace(osName), "platform": runtime.GOOS, "arch": runtime.GOARCH,
		"kernel": kernel, "agentVersion": s.Version,
		"bootTime": bootTime, "uptimeSec": uptime,
		"time": time.Now().Format(time.RFC3339), "timezone": timezoneName(),
		"features": f,
		"capabilities": map[string]bool{
			"sleep": caps.Sleep, "hibernate": caps.Hibernate,
			"wake": caps.Wake, "screenOff": caps.ScreenOff,
		},
	})
}

func hostname() string {
	h, err := host.Info()
	if err != nil || h == nil {
		return ""
	}
	return h.Hostname
}

func timezoneName() string {
	name, _ := time.Now().Zone()
	return name
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request, c *config.Client) {
	writeJSON(w, http.StatusOK, s.Sampler.Snapshot())
}

func (s *Server) handleHardware(w http.ResponseWriter, r *http.Request, c *config.Client) {
	writeJSON(w, http.StatusOK, metrics.HardwareCached())
}

func (s *Server) handleUptime(w http.ResponseWriter, r *http.Request, c *config.Client) {
	// 默认给 90 天：按月聚合需要足够跨度（用户要求「按照月统计」）
	days := 90
	if v := r.URL.Query().Get("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			days = n
		}
	}
	writeJSON(w, http.StatusOK, metrics.CachedHistory(days))
}

// ---------- 动作 ----------

type actionResult struct {
	OK         bool   `json:"ok"`
	Action     string `json:"action"`
	Detail     string `json:"detail"`
	DurationMs int64  `json:"durationMs"`
}

var actionMeta = []map[string]any{
	{"action": "power.shutdown", "params": map[string]string{"delay": "秒", "force": "bool"}},
	{"action": "power.restart", "params": map[string]string{"delay": "秒", "force": "bool"}},
	{"action": "power.sleep", "params": map[string]string{}},
	{"action": "power.hibernate", "params": map[string]string{}},
	{"action": "power.lock", "params": map[string]string{}},
	{"action": "power.logoff", "params": map[string]string{}},
	{"action": "power.screen_off", "params": map[string]string{}},
	{"action": "power.cancel", "params": map[string]string{}},
	{"action": "volume.set", "params": map[string]string{"value": "0-100"}},
	{"action": "volume.up", "params": map[string]string{"step": "默认 5"}},
	{"action": "volume.down", "params": map[string]string{"step": "默认 5"}},
	{"action": "volume.mute", "params": map[string]string{}},
	{"action": "volume.unmute", "params": map[string]string{}},
	{"action": "volume.toggle_mute", "params": map[string]string{}},
	{"action": "media.play_pause", "params": map[string]string{}},
	{"action": "media.next", "params": map[string]string{}},
	{"action": "media.prev", "params": map[string]string{}},
	{"action": "media.stop", "params": map[string]string{}},
	{"action": "wake.on_lan", "params": map[string]string{"mac": "AA:BB:CC:DD:EE:FF"}},
}

func (s *Server) handleActionList(w http.ResponseWriter, r *http.Request, c *config.Client) {
	caps := s.Ctrl.Caps()
	out := make([]map[string]any, 0, len(actionMeta))
	for _, a := range actionMeta {
		action := a["action"].(string)
		supported := true
		switch action {
		case "power.sleep":
			supported = caps.Sleep
		case "power.hibernate":
			supported = caps.Hibernate
		case "power.screen_off":
			supported = caps.ScreenOff
		case "wake.on_lan":
			supported = caps.Wake
		case "volume.set", "volume.up", "volume.down", "volume.mute", "volume.unmute", "volume.toggle_mute":
			supported = caps.Volume
		case "media.play_pause", "media.next", "media.prev", "media.stop":
			supported = caps.Media
		}
		out = append(out, map[string]any{"action": action, "supported": supported, "params": a["params"]})
	}
	writeJSON(w, http.StatusOK, map[string]any{"actions": out})
}

type actionReq struct {
	Action string         `json:"action"`
	Params map[string]any `json:"params"`
	// 兼容 /power /volume /media 三个便捷端点
	Op    string `json:"op"`
	Value *int   `json:"value"`
	Step  *int   `json:"step"`
	Delay *int   `json:"delay"`
	Force *bool  `json:"force"`
	MAC   string `json:"mac"`
}

func (s *Server) handleAction(w http.ResponseWriter, r *http.Request, c *config.Client) {
	var req actionReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "请求格式不正确")
		return
	}
	action := req.Action
	params := req.Params
	if params == nil {
		params = map[string]any{}
	}
	// 便捷端点：/power {op} → power.<op>
	if action == "" && req.Op != "" {
		prefix := "power"
		switch r.URL.Path {
		case "/api/v1/volume":
			prefix = "volume"
		case "/api/v1/media":
			prefix = "media"
		}
		action = prefix + "." + req.Op
	}
	if req.Value != nil {
		params["value"] = float64(*req.Value)
	}
	if req.Step != nil {
		params["step"] = float64(*req.Step)
	}
	if req.Delay != nil {
		params["delay"] = float64(*req.Delay)
	}
	if req.Force != nil {
		params["force"] = *req.Force
	}
	if req.MAC != "" {
		params["mac"] = req.MAC
	}
	if action == "" {
		writeErr(w, http.StatusBadRequest, "bad_request", "缺少 action")
		return
	}

	start := time.Now()
	res, err := s.dispatch(action, params)
	res.DurationMs = time.Since(start).Milliseconds()
	res.Action = action
	if err != nil {
		code := http.StatusBadRequest
		errCode := "failed"
		msg := err.Error()
		if errors.Is(err, control.ErrUnsupported) {
			code = http.StatusConflict
			errCode = "unsupported"
			msg = "当前设备/平台不支持该操作"
		}
		s.Acts.Add(store_activity("操作失败", c.Name, false, action+": "+msg))
		writeErr(w, code, errCode, msg)
		return
	}
	res.OK = true
	s.Acts.Add(store_activity(actionLabel(action, params), c.Name, true, res.Detail))
	s.hub.broadcastEvent(map[string]any{
		"event": "action", "action": action, "ok": true,
		"clientName": c.Name, "at": time.Now().Format(time.RFC3339),
	})
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) dispatch(action string, params map[string]any) (*actionResult, error) {
	res := &actionResult{Detail: "已执行"}
	switch {
	case strings.HasPrefix(action, "power."):
		op := strings.TrimPrefix(action, "power.")
		delay := pInt(params, "delay", 5)
		force := pBool(params, "force", false)
		if op == "cancel" {
			delay = 0
		}
		if err := s.Ctrl.Power(op, delay, force); err != nil {
			return nil, err
		}
		switch op {
		case "shutdown":
			res.Detail = fmt.Sprintf("%d 秒后关机", delay)
		case "restart":
			res.Detail = fmt.Sprintf("%d 秒后重启", delay)
		case "sleep":
			res.Detail = "已进入睡眠"
		case "hibernate":
			res.Detail = "已进入休眠"
		case "lock":
			res.Detail = "已锁屏"
		case "logoff":
			res.Detail = "已注销"
		case "screen_off":
			res.Detail = "已关闭屏幕"
		case "cancel":
			res.Detail = "已取消待执行的关机"
		}
	case strings.HasPrefix(action, "volume."):
		op := strings.TrimPrefix(action, "volume.")
		switch op {
		case "set":
			v := pInt(params, "value", 50)
			st, err := s.Ctrl.Volume(control.VolSet, v)
			if err != nil {
				return nil, err
			}
			res.Detail = fmt.Sprintf("音量 %d%%", st.Level)
		case "up", "down":
			step := pInt(params, "step", 5)
			opName := control.VolUp
			if op == "down" {
				opName = control.VolDown
			}
			st, err := s.Ctrl.Volume(opName, step)
			if err != nil {
				return nil, err
			}
			res.Detail = fmt.Sprintf("音量 %d%%", st.Level)
		case "mute":
			st, err := s.Ctrl.Volume(control.VolMute, 0)
			if err != nil {
				return nil, err
			}
			res.Detail = fmt.Sprintf("已静音（音量 %d%%）", st.Level)
		case "unmute":
			st, err := s.Ctrl.Volume(control.VolUnmute, 0)
			if err != nil {
				return nil, err
			}
			res.Detail = fmt.Sprintf("已取消静音（音量 %d%%）", st.Level)
		case "toggle_mute":
			st, err := s.Ctrl.Volume(control.VolToggleMute, 0)
			if err != nil {
				return nil, err
			}
			if st.Muted {
				res.Detail = "已静音"
			} else {
				res.Detail = "已取消静音"
			}
		default:
			return nil, control.ErrUnsupported
		}
	case strings.HasPrefix(action, "media."):
		op := strings.TrimPrefix(action, "media.")
		var mop string
		switch op {
		case "play_pause":
			mop = control.MediaPlayPause
		case "next":
			mop = control.MediaNext
		case "prev":
			mop = control.MediaPrev
		case "stop":
			mop = control.MediaStop
		default:
			return nil, control.ErrUnsupported
		}
		if err := s.Ctrl.Media(mop); err != nil {
			return nil, err
		}
		res.Detail = map[string]string{
			"play_pause": "已发送播放/暂停",
			"next":       "已切换下一首",
			"prev":       "已切换上一首",
			"stop":       "已停止播放",
		}[op]
	case action == "wake.on_lan":
		mac := pString(params, "mac", "")
		if mac == "" {
			return nil, errBadParams
		}
		if !s.Cfg.Get().Features.AllowWol {
			return nil, control.ErrUnsupported
		}
		if err := s.Ctrl.Wake(mac); err != nil {
			return nil, err
		}
		res.Detail = "已发送唤醒魔术包到 " + mac
	default:
		return nil, control.ErrUnsupported
	}
	return res, nil
}

func actionLabel(action string, params map[string]any) string {
	labels := map[string]string{
		"power.shutdown": "关机", "power.restart": "重启", "power.sleep": "睡眠",
		"power.hibernate": "休眠", "power.lock": "锁屏", "power.logoff": "注销",
		"power.screen_off": "关闭屏幕", "power.cancel": "取消关机",
		"volume.set": "调节音量", "volume.up": "音量+", "volume.down": "音量-",
		"volume.mute": "静音", "volume.unmute": "取消静音", "volume.toggle_mute": "切换静音",
		"media.play_pause": "播放/暂停", "media.next": "下一首", "media.prev": "上一首",
		"media.stop": "停止播放", "wake.on_lan": "网络唤醒",
	}
	if l, ok := labels[action]; ok {
		return l
	}
	return action
}

// GET /api/v1/volume —— UI 首屏要知道当前音量与静音状态
func (s *Server) handleVolumeGet(w http.ResponseWriter, r *http.Request, c *config.Client) {
	st, err := s.Ctrl.VolumeState()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"level": 0, "muted": false, "known": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"level": st.Level, "muted": st.Muted, "known": st.Known})
}

// GET /api/v1/media —— 当前播放内容与状态（Windows 走 SMTC，Linux 走 MPRIS）
func (s *Server) handleMediaGet(w http.ResponseWriter, r *http.Request, c *config.Client) {
	writeJSON(w, http.StatusOK, s.mediaState())
}

func (s *Server) mediaState() control.MediaInfo {
	info, err := s.Ctrl.MediaState()
	if err != nil {
		log.Printf("媒体状态读取失败: %v", err)
		return control.MediaInfo{Known: false}
	}
	// 估算当前播放位置：SMTC 给的是"上一次更新的位置"，播放中要按流逝时间外推
	if info.Active && info.Playing && info.UpdatedAt > 0 {
		elapsed := float64(time.Now().Unix()) - info.UpdatedAt
		if elapsed > 0 && elapsed < 600 {
			info.PositionSec += elapsed
			if info.DurationSec > 0 && info.PositionSec > info.DurationSec {
				info.PositionSec = info.DurationSec
			}
		}
	}
	return info
}

// ---------- 定时任务 ----------

func (s *Server) handleSchedulesList(w http.ResponseWriter, r *http.Request, c *config.Client) {
	writeJSON(w, http.StatusOK, map[string]any{"items": s.Sched.List()})
}

func scheduleFromBody(w http.ResponseWriter, r *http.Request) (scheduler.Task, bool) {
	var t scheduler.Task
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384)).Decode(&t); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "请求格式不正确")
		return t, false
	}
	return t, true
}

func (s *Server) handleScheduleCreate(w http.ResponseWriter, r *http.Request, c *config.Client) {
	t, ok := scheduleFromBody(w, r)
	if !ok {
		return
	}
	if !s.Cfg.Get().Features.AllowSchedules {
		writeErr(w, http.StatusConflict, "disabled", "定时任务已被关闭")
		return
	}
	t.ID = ""
	saved, err := s.Sched.Upsert(t)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	s.Acts.Add(store_activity("新建定时任务 "+saved.Name, c.Name, true, saved.When.Time))
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) handleScheduleUpdate(w http.ResponseWriter, r *http.Request, c *config.Client) {
	id := r.PathValue("id")
	t, ok := scheduleFromBody(w, r)
	if !ok {
		return
	}
	if _, exists := s.Sched.Get(id); !exists {
		writeErr(w, http.StatusNotFound, "not_found", "定时任务不存在")
		return
	}
	t.ID = id
	saved, err := s.Sched.Upsert(t)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) handleScheduleDelete(w http.ResponseWriter, r *http.Request, c *config.Client) {
	id := r.PathValue("id")
	if !s.Sched.Delete(id) {
		writeErr(w, http.StatusNotFound, "not_found", "定时任务不存在")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------- 客户端管理 ----------

func (s *Server) handleClients(w http.ResponseWriter, r *http.Request, c *config.Client) {
	list := s.Auth.List()
	items := make([]map[string]any, 0, len(list))
	for _, cl := range list {
		items = append(items, map[string]any{
			"id": cl.ID, "name": cl.Name, "role": cl.Role, "ip": cl.IP,
			"createdAt": cl.CreatedAt.Format(time.RFC3339),
			"lastSeenAt": cl.LastSeenAt.Format(time.RFC3339),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleClientRevoke(w http.ResponseWriter, r *http.Request, c *config.Client) {
	id := r.PathValue("id")
	if id == c.ID {
		writeErr(w, http.StatusBadRequest, "bad_request", "不能吊销当前正在使用的客户端")
		return
	}
	if !s.Auth.Revoke(id) {
		writeErr(w, http.StatusNotFound, "not_found", "客户端不存在")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleClientRotate(w http.ResponseWriter, r *http.Request, c *config.Client) {
	id := r.PathValue("id")
	token, ok := s.Auth.Rotate(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "not_found", "客户端不存在")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}

// ---------- 配对设置 ----------

func (s *Server) handlePairingGet(w http.ResponseWriter, r *http.Request, c *config.Client) {
	cfg := s.Cfg.Get()
	code, exp := s.Auth.Code()
	writeJSON(w, http.StatusOK, map[string]any{
		"fixedKeyMasked":   config.MaskKey(cfg.FixedKey),
		"fixedKeySet":      cfg.FixedKey != "",
		"randomEnabled":    cfg.RandomEnabled,
		"code":             groupCode(code),
		"codeExpiresAt":    exp.Format(time.RFC3339),
		"requireLocalCode": cfg.RequireLocalCode,
	})
}

func groupCode(code string) string {
	if len(code) != 6 {
		return code
	}
	return code[:3] + " " + code[3:]
}

func (s *Server) handlePairingPut(w http.ResponseWriter, r *http.Request, c *config.Client) {
	var body struct {
		FixedKey      *string `json:"fixedKey"`
		RandomEnabled *bool   `json:"randomEnabled"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "请求格式不正确")
		return
	}
	if body.FixedKey != nil {
		if err := s.Auth.SetFixedKey(*body.FixedKey); err != nil {
			writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
	}
	if body.RandomEnabled != nil {
		_ = s.Cfg.Update(func(cc *config.Config) error {
			cc.RandomEnabled = *body.RandomEnabled
			return nil
		})
	}
	s.handlePairingGet(w, r, c)
}

func (s *Server) handleCodeRotate(w http.ResponseWriter, r *http.Request, c *config.Client) {
	code, exp := s.Auth.RotateCode()
	writeJSON(w, http.StatusOK, map[string]string{
		"code":          groupCode(code),
		"codeExpiresAt": exp.Format(time.RFC3339),
	})
}

// ---------- 设置 ----------

func settingsPayload(cfg config.Config) map[string]any {
	return map[string]any{
		"deviceName": cfg.DeviceName,
		"port":       effectivePort(cfg),
		"tls":        cfg.TLS,
		"features": map[string]bool{
			"allowWol":         cfg.Features.AllowWol,
			"allowSchedules":   cfg.Features.AllowSchedules,
			"allowShell":       cfg.Features.AllowShell,
			"allowProcessKill": cfg.Features.AllowProcessKill,
		},
		"locale": cfg.Locale,
		"theme":  cfg.Theme,
		"files":  cfg.Files,
	}
}

func (s *Server) handleSettingsGet(w http.ResponseWriter, r *http.Request, c *config.Client) {
	writeJSON(w, http.StatusOK, settingsPayload(s.Cfg.Get()))
}

func (s *Server) handleSettingsPut(w http.ResponseWriter, r *http.Request, c *config.Client) {
	var body struct {
		DeviceName *string `json:"deviceName"`
		Port       *int    `json:"port"`
		TLS        *struct {
			Enabled bool   `json:"enabled"`
			Cert    string `json:"cert"`
			Key     string `json:"key"`
		} `json:"tls"`
		Features *struct {
			AllowWol         bool `json:"allowWol"`
			AllowSchedules   bool `json:"allowSchedules"`
			AllowShell       bool `json:"allowShell"`
			AllowProcessKill bool `json:"allowProcessKill"`
		} `json:"features"`
		Files *config.FilesConfig `json:"files"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "请求格式不正确")
		return
	}
	restart := false
	err := s.Cfg.Update(func(cc *config.Config) error {
		if body.DeviceName != nil && strings.TrimSpace(*body.DeviceName) != "" {
			cc.DeviceName = strings.TrimSpace(*body.DeviceName)
		}
		if body.Port != nil && *body.Port != cc.Port {
			if *body.Port < 1 || *body.Port > 65535 {
				return errors.New("端口范围 1-65535")
			}
			cc.Port = *body.Port
			restart = true
		}
		if body.TLS != nil {
			if body.TLS.Enabled != cc.TLS.Enabled {
				restart = true
			}
			cc.TLS = config.TLSConfig{Enabled: body.TLS.Enabled, Cert: body.TLS.Cert, Key: body.TLS.Key}
		}
		if body.Files != nil {
			cc.Files = *body.Files
			if cc.Files.Roots == nil {
				cc.Files.Roots = []string{}
			}
		}
		if body.Features != nil {
			cc.Features = config.Features{
				AllowWol:         body.Features.AllowWol,
				AllowSchedules:   body.Features.AllowSchedules,
				AllowShell:       body.Features.AllowShell,
				AllowProcessKill: body.Features.AllowProcessKill,
			}
		}
		return nil
	})
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	out := settingsPayload(s.Cfg.Get())
	if restart {
		out["note"] = "端口 / TLS 改动需要重启 Agent 才能生效"
		out["restartRequired"] = true
	}
	writeJSON(w, http.StatusOK, out)
}

// ---------- 活动日志 ----------

func (s *Server) handleActivity(w http.ResponseWriter, r *http.Request, c *config.Client) {
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": s.Acts.List(limit, r.URL.Query().Get("before")),
	})
}

// ---------- 进程 ----------

func (s *Server) handleProcesses(w http.ResponseWriter, r *http.Request, c *config.Client) {
	if !s.Cfg.Get().Features.AllowProcessKill {
		// 关闭进程能力时一并关闭查看，避免暴露不该看的细节
		writeErr(w, http.StatusConflict, "disabled", "进程查看已被关闭")
		return
	}
	q := metrics.ProcessQuery{
		Sort:  r.URL.Query().Get("sort"),
		Query: r.URL.Query().Get("q"),
		Limit: 60,
	}
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			q.Limit = n
		}
	}
	items, err := metrics.ListProcesses(q)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (s *Server) handleKillProcess(w http.ResponseWriter, r *http.Request, c *config.Client) {
	if !s.Cfg.Get().Features.AllowProcessKill {
		writeErr(w, http.StatusConflict, "disabled", "结束进程能力已被关闭")
		return
	}
	var body struct {
		PID   int32  `json:"pid"`
		Name  string `json:"name"`
		Force bool   `json:"force"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "请求格式不正确")
		return
	}
	var (
		pid int32
		err error
	)
	if body.PID > 0 {
		pid = body.PID
		err = metrics.KillProcess(body.PID, body.Force)
	} else if body.Name != "" {
		pid, err = metrics.KillProcessByName(body.Name, body.Force)
	} else {
		writeErr(w, http.StatusBadRequest, "bad_request", "需要 pid 或 name")
		return
	}
	if err != nil {
		writeErr(w, http.StatusBadRequest, "failed", err.Error())
		return
	}
	label := fmt.Sprintf("结束进程 %d", pid)
	if body.Name != "" {
		label = "结束进程 " + body.Name
	}
	s.Acts.Add(store_activity(label, c.Name, true, "PID "+strconv.Itoa(int(pid))))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "pid": pid})
}

// ---------- 按应用聚合 ----------

func (s *Server) handleApps(w http.ResponseWriter, r *http.Request, c *config.Client) {
	if !s.Cfg.Get().Features.AllowProcessKill {
		writeErr(w, http.StatusConflict, "disabled", "进程查看已被关闭")
		return
	}
	q := metrics.AppQuery{
		Sort:  r.URL.Query().Get("sort"),
		Query: r.URL.Query().Get("q"),
		Limit: 80,
	}
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			q.Limit = n
		}
	}
	items, err := metrics.ListApps(q)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (s *Server) handleKillApp(w http.ResponseWriter, r *http.Request, c *config.Client) {
	if !s.Cfg.Get().Features.AllowProcessKill {
		writeErr(w, http.StatusConflict, "disabled", "结束进程能力已被关闭")
		return
	}
	var body struct {
		Key   string `json:"key"`
		Force bool   `json:"force"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "请求格式不正确")
		return
	}
	if body.Key == "" {
		writeErr(w, http.StatusBadRequest, "bad_request", "需要 key")
		return
	}
	n, err := metrics.KillApp(body.Key, body.Force)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "failed", err.Error())
		return
	}
	s.Acts.Add(store_activity("结束应用 "+body.Key, c.Name, true, strconv.Itoa(n)+" 个进程"))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "killed": n})
}

// GET /api/v1/stats —— 本机统计总览（给「统计」页用）
//
// 一次请求把页面需要的都算好：运行时长、资源水位、开机历史、操作统计、
// 进程/应用数量、磁盘占用。避免前端发 5 个请求再自己拼。
func (s *Server) handleStats(w http.ResponseWriter, r *http.Request, c *config.Client) {
	// 默认给 90 天：按月聚合需要足够跨度（用户要求「按照月统计」）
	days := 90
	if v := r.URL.Query().Get("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 90 {
			days = n
		}
	}

	snap := s.Sampler.Snapshot()
	uptime := metrics.CachedHistory(days)
	acts := s.Acts.Aggregate(days)

	// 应用与进程数量：走 AppProcCount 的轻量路径（30s 缓存，只枚举进程名）。
	//
	// 原来这里用 metrics.ListApps(Limit:300)，它内部走 cachedProcesses() →
	// sampleProcesses()，含一次 time.Sleep(200ms) 再遍历 480 个进程取
	// Name/CPU/内存/用户/启动时间，实测 290~330ms，且缓存 TTL 只有 2s。
	// 手机端切到统计页时经常正好过期，于是每次切页卡一下。
	// 统计页只需要「个数」，不需要那些重字段。
	appCount, procCount := metrics.AppProcCount()

	cfg := s.Cfg.Get()
	out := map[string]any{
		"generatedAt": time.Now().Format(time.RFC3339),
		"device": map[string]any{
			"id": cfg.DeviceID, "name": cfg.DeviceName,
			"platform": runtime.GOOS, "arch": runtime.GOARCH,
			"agentVersion": s.Version,
			"bootTime":     snap.BootTime,
			"uptimeSec":    snap.UptimeSec,
		},
		"realtime": map[string]any{
			"cpu":  snap.CPU.Percent,
			"mem":  snap.Mem.Percent,
			"memUsed": snap.Mem.Used, "memTotal": snap.Mem.Total,
			"rxBps": snap.Net.RxBps, "txBps": snap.Net.TxBps,
			"disks": snap.Disks,
			"battery": snap.Battery,
			"temps": snap.Temps,
		},
		"counts": map[string]any{
			"apps": appCount, "processes": procCount,
			"clients": len(cfg.Clients),
			"schedules": len(s.Sched.List()),
		},
		"uptime": uptime,
		"activity": acts,
	}
	writeJSON(w, http.StatusOK, out)
}
