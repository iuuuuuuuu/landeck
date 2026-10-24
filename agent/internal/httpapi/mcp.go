package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"

	"landeck/internal/metrics"
	"landeck/internal/scheduler"
)

// MCP（Model Context Protocol）控制面：JSON-RPC 2.0 over HTTP。
// 让 AI 客户端通过标准工具调用控制这台 PC：电源、音量、媒体、状态、定时、日志。

const mcpProtocolVersion = "2025-06-18"

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (s *Server) handleMCPInfo(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"mcp":     "LandDeck MCP endpoint",
		"transport": "streamable-http (JSON-RPC 2.0 over POST)",
		"auth":    "Authorization: Bearer <paired token>",
		"tools":   toolNames(),
		"usage":   `POST {"jsonrpc":"2.0","id":1,"method":"tools/list"} with Bearer token`,
	})
}

func (s *Server) handleMCP(w http.ResponseWriter, r *http.Request) {
	token := bearer(r)
	client, ok := s.Auth.Authenticate(token)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "MCP 需要配对令牌")
		return
	}
	var req rpcRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256*1024)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"jsonrpc": "2.0", "id": nil,
			"error": rpcError{Code: -32700, Message: "JSON 解析失败"},
		})
		return
	}
	if req.JSONRPC == "" {
		req.JSONRPC = "2.0"
	}

	// 通知（无 id）不需要响应体
	if len(req.ID) == 0 || bytes.Equal(req.ID, []byte("null")) {
		w.WriteHeader(http.StatusAccepted)
		return
	}

	switch req.Method {
	case "initialize":
		s.mcpResult(w, req.ID, map[string]any{
			"protocolVersion": mcpProtocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
			"serverInfo":      map[string]any{"name": "landeck", "version": s.Version},
			"instructions":    "LanDeck 控制这台电脑：先调 landeck_status 看状态，再用 landeck_power / landeck_volume / landeck_media 操作。危险动作会把 delay 秒后执行，可用 landeck_power cancel 取消。",
		})
	case "ping":
		s.mcpResult(w, req.ID, map[string]any{})
	case "tools/list":
		s.mcpResult(w, req.ID, map[string]any{"tools": toolDefs()})
	case "tools/call":
		var call struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &call); err != nil {
			s.mcpError(w, req.ID, -32602, "tools/call 参数不合法")
			return
		}
		text, isErr := s.callTool(call.Name, call.Arguments, client.Name)
		s.mcpResult(w, req.ID, map[string]any{
			"content": []map[string]any{{"type": "text", "text": text}},
			"isError": isErr,
		})
	case "resources/list":
		s.mcpResult(w, req.ID, map[string]any{"resources": []any{}})
	case "prompts/list":
		s.mcpResult(w, req.ID, map[string]any{"prompts": []any{}})
	default:
		s.mcpError(w, req.ID, -32601, fmt.Sprintf("未实现的方法: %s", req.Method))
	}
}

func (s *Server) mcpResult(w http.ResponseWriter, id json.RawMessage, result any) {
	writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
}

func (s *Server) mcpError(w http.ResponseWriter, id json.RawMessage, code int, msg string) {
	writeJSON(w, http.StatusOK, map[string]any{
		"jsonrpc": "2.0", "id": id, "error": rpcError{Code: code, Message: msg},
	})
}

func toolNames() []string {
	defs := toolDefs()
	out := make([]string, 0, len(defs))
	for _, d := range defs {
		out = append(out, d["name"].(string))
	}
	return out
}

func toolDefs() []map[string]any {
	return []map[string]any{
		{
			"name":        "landeck_status",
			"description": "读取这台电脑的实时状态：CPU/内存占用、磁盘、网络速率、运行时长。",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
		},
		{
			"name":        "landeck_power",
			"description": "电源控制。op 取值 shutdown/restart/sleep/hibernate/lock/logoff/screen_off/cancel。关机与重启会先延迟 delay 秒（默认 5），期间可用 cancel 取消。",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"op":    map[string]any{"type": "string", "enum": []string{"shutdown", "restart", "sleep", "hibernate", "lock", "logoff", "screen_off", "cancel"}},
					"delay": map[string]any{"type": "number", "description": "延迟秒数，默认 5"},
					"force": map[string]any{"type": "boolean", "description": "强制关闭未保存的程序"},
				},
				"required": []string{"op"},
			},
		},
		{
			"name":        "landeck_volume",
			"description": "音量控制。op 取值 set/up/down/mute/unmute/toggle_mute。",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"op":    map[string]any{"type": "string", "enum": []string{"set", "up", "down", "mute", "unmute", "toggle_mute"}},
					"value": map[string]any{"type": "number", "description": "set 时的目标音量 0-100"},
					"step":  map[string]any{"type": "number", "description": "up/down 的步长，默认 5"},
				},
				"required": []string{"op"},
			},
		},
		{
			"name":        "landeck_media",
			"description": "媒体播放控制。op 取值 play_pause/next/prev/stop。",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"op": map[string]any{"type": "string", "enum": []string{"play_pause", "next", "prev", "stop"}},
				},
				"required": []string{"op"},
			},
		},
		{
			"name":        "landeck_hardware",
			"description": "读取硬件信息：CPU、内存条、显卡、磁盘、网卡、主板、操作系统。",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
		},
		{
			"name":        "landeck_uptime",
			"description": "开机统计：近 N 天每天的开机时长与启动次数，以及最近启动事件。",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{"days": map[string]any{"type": "number", "description": "统计天数，默认 14"}},
			},
		},
		{
			"name":        "landeck_schedules",
			"description": "定时任务。op=list 列出，op=create 新建（需 name/action/time，可选 weekdays/kind），op=delete 删除（需 id）。",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"op":       map[string]any{"type": "string", "enum": []string{"list", "create", "delete"}},
					"id":       map[string]any{"type": "string"},
					"name":     map[string]any{"type": "string"},
					"action":   map[string]any{"type": "string", "description": "如 power.shutdown / power.restart / power.sleep"},
					"time":     map[string]any{"type": "string", "description": "HH:MM"},
					"kind":     map[string]any{"type": "string", "enum": []string{"daily", "weekly"}},
					"weekdays": map[string]any{"type": "array", "items": map[string]any{"type": "number"}, "description": "0=周日 … 6=周六"},
					"wake":     map[string]any{"type": "boolean", "description": "是否允许 RTC 唤醒"},
				},
				"required": []string{"op"},
			},
		},
		{
			"name":        "landeck_processes",
			"description": "列出进程（按 CPU 或内存排序，可按名称过滤）。用于排查卡顿、占满内存的程序。",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"sort":  map[string]any{"type": "string", "enum": []string{"cpu", "mem", "name", "pid"}},
					"limit": map[string]any{"type": "number", "description": "默认 20"},
					"query": map[string]any{"type": "string", "description": "按进程名/路径/用户过滤"},
				},
			},
		},
		{
			"name":        "landeck_kill_process",
			"description": "结束进程。优先用 pid；只有同名进程唯一时才允许用 name。系统关键进程会被拒绝。",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"pid":   map[string]any{"type": "number"},
					"name":  map[string]any{"type": "string"},
					"force": map[string]any{"type": "boolean", "description": "强制结束（等价 kill -9 / TerminateProcess）"},
				},
			},
		},
		{
			"name":        "landeck_activity",
			"description": "最近的远程操作日志（谁在什么时候做了什么）。",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{"limit": map[string]any{"type": "number", "description": "默认 20"}},
			},
		},
	}
}

// callTool 执行工具，返回给 AI 的文本与是否错误。
func (s *Server) callTool(name string, args map[string]any, clientName string) (string, bool) {
	if args == nil {
		args = map[string]any{}
	}
	jsonOut := func(v any) (string, bool) {
		raw, err := json.MarshalIndent(v, "", "  ")
		if err != nil {
			return err.Error(), true
		}
		return string(raw), false
	}
	fail := func(err error) (string, bool) { return "错误: " + err.Error(), true }

	switch name {
	case "landeck_status":
		return jsonOut(s.Sampler.Snapshot())
	case "landeck_power":
		op := pString(args, "op", "")
		if op == "" {
			return "错误: 缺少 op", true
		}
		res, err := s.dispatch("power."+op, args)
		if err != nil {
			return fail(err)
		}
		s.Acts.Add(store_activity("MCP 电源 "+op, clientName, true, res.Detail))
		return jsonOut(map[string]any{"ok": true, "detail": res.Detail})
	case "landeck_volume":
		op := pString(args, "op", "")
		if op == "" {
			return "错误: 缺少 op", true
		}
		res, err := s.dispatch("volume."+op, args)
		if err != nil {
			return fail(err)
		}
		s.Acts.Add(store_activity("MCP 音量 "+op, clientName, true, res.Detail))
		return jsonOut(map[string]any{"ok": true, "detail": res.Detail})
	case "landeck_media":
		op := pString(args, "op", "")
		if op == "" {
			return "错误: 缺少 op", true
		}
		res, err := s.dispatch("media."+op, args)
		if err != nil {
			return fail(err)
		}
		s.Acts.Add(store_activity("MCP 媒体 "+op, clientName, true, res.Detail))
		return jsonOut(map[string]any{"ok": true, "detail": res.Detail})
	case "landeck_hardware":
		return jsonOut(s.hardwarePayload())
	case "landeck_uptime":
		return jsonOut(metricsHistory(pInt(args, "days", 14)))
	case "landeck_schedules":
		switch pString(args, "op", "list") {
		case "list":
			return jsonOut(map[string]any{"items": s.Sched.List()})
		case "create":
			params := map[string]any{}
			if v, ok := args["params"].(map[string]any); ok {
				params = v
			}
			kind := pString(args, "kind", "daily")
			when := map[string]any{"kind": kind, "time": pString(args, "time", "23:30")}
			if wd, ok := args["weekdays"].([]any); ok {
				list := make([]int, 0, len(wd))
				for _, v := range wd {
					if n, ok := v.(float64); ok {
						list = append(list, int(n))
					}
				}
				when["weekdays"] = list
			}
			task := map[string]any{
				"name": pString(args, "name", "AI 定时任务"), "enabled": true,
				"action": pString(args, "action", "power.shutdown"), "params": params,
				"when": when,
				"wake": map[string]any{"enabled": pBool(args, "wake", false), "leadSec": 60},
			}
			raw, _ := json.Marshal(task)
			var t schedTask
			if err := json.Unmarshal(raw, &t); err != nil {
				return fail(err)
			}
			saved, err := s.Sched.Upsert(t.toTask())
			if err != nil {
				return fail(err)
			}
			return jsonOut(saved)
		case "delete":
			id := pString(args, "id", "")
			if id == "" {
				return "错误: 缺少 id", true
			}
			if !s.Sched.Delete(id) {
				return "错误: 任务不存在", true
			}
			return jsonOut(map[string]any{"ok": true})
		}
		return "错误: 未知 op", true
	case "landeck_processes":
		items, err := metrics.ListProcesses(metrics.ProcessQuery{
			Sort:  pString(args, "sort", "cpu"),
			Query: pString(args, "query", ""),
			Limit: pInt(args, "limit", 20),
		})
		if err != nil {
			return fail(err)
		}
		return jsonOut(map[string]any{"items": items, "total": len(items)})
	case "landeck_kill_process":
		pid := int32(pInt(args, "pid", 0))
		name := pString(args, "name", "")
		force := pBool(args, "force", false)
		var err error
		if pid > 0 {
			err = metrics.KillProcess(pid, force)
		} else if name != "" {
			pid, err = metrics.KillProcessByName(name, force)
		} else {
			return "错误: 需要 pid 或 name", true
		}
		if err != nil {
			return fail(err)
		}
		s.Acts.Add(store_activity("MCP 结束进程", clientName, true, fmt.Sprintf("PID %d", pid)))
		return jsonOut(map[string]any{"ok": true, "pid": pid})
	case "landeck_activity":
		items := s.Acts.List(pInt(args, "limit", 20), "")
		return jsonOut(map[string]any{"items": items})
	}
	return fmt.Sprintf("错误: 未知工具 %s", name), true
}

// 小助手：避免在 mcp.go 里直接依赖 scheduler 的构造细节
type schedTask struct {
	Name    string         `json:"name"`
	Enabled bool           `json:"enabled"`
	Action  string         `json:"action"`
	Params  map[string]any `json:"params"`
	When    struct {
		Kind     string `json:"kind"`
		Time     string `json:"time"`
		Weekdays []int  `json:"weekdays"`
		At       string `json:"at"`
	} `json:"when"`
	Wake struct {
		Enabled bool `json:"enabled"`
		LeadSec int  `json:"leadSec"`
	} `json:"wake"`
}

func (s *Server) hardwarePayload() any { return metrics.HardwareCached() }

func metricsHistory(days int) any { return metrics.CachedHistory(days) }

func (t schedTask) toTask() scheduler.Task {
	return scheduler.Task{
		Name:    t.Name,
		Enabled: t.Enabled,
		Action:  t.Action,
		Params:  t.Params,
		When: scheduler.When{
			Kind:     t.When.Kind,
			Time:     t.When.Time,
			Weekdays: t.When.Weekdays,
			At:       t.When.At,
		},
		Wake: scheduler.WakeOpt{Enabled: t.Wake.Enabled, LeadSec: t.Wake.LeadSec},
	}
}
