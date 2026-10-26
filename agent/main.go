package main

import (
	"bufio"
	"context"
	"os/exec"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"landeck/internal/auth"
	"landeck/internal/config"
	"landeck/internal/control"
	"landeck/internal/discovery"
	"landeck/internal/httpapi"
	"landeck/internal/metrics"
	"landeck/internal/scheduler"
	"landeck/internal/store"
	"landeck/internal/tray"
)

const Version = "1.0.11"

func main() {
	log.SetFlags(log.Ltime)
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "mcp":
			runMCPProxy(os.Args[2:])
			return
		case "install", "uninstall", "service":
			runService(os.Args[1:])
			return
		case "version", "--version", "-v":
			fmt.Printf("LanDeck Agent %s (%s/%s)\n", Version, runtime.GOOS, runtime.GOARCH)
			return
		}
	}
	runServer()
}

type options struct {
	dataDir  string
	port     int
	bind     string
	name     string
	dryRun   bool
	noMDNS   bool
	quiet    bool
}

func dataDirDefault() string {
	exe, err := os.Executable()
	if err != nil {
		return "./data"
	}
	return filepath.Join(filepath.Dir(exe), "data")
}

func runServer() {
	var o options
	flag.StringVar(&o.dataDir, "data", dataDirDefault(), "数据目录（配置、日志、定时任务）")
	flag.IntVar(&o.port, "port", 0, "HTTP 端口，默认读配置（8420）")
	flag.StringVar(&o.bind, "bind", "", "监听地址，默认 0.0.0.0")
	flag.StringVar(&o.name, "name", "", "设备显示名，默认取主机名")
	flag.BoolVar(&o.dryRun, "dry-run", false, "演练模式：不真正关机/发送媒体键（用于调试）")
	flag.BoolVar(&o.noMDNS, "no-mdns", false, "关闭 mDNS 广播")
	flag.BoolVar(&o.quiet, "quiet", false, "少打日志")
	noTray := flag.Bool("no-tray", false, "不启动托盘（纯命令行/服务模式）")
	noOpen := flag.Bool("no-open", false, "首次运行也不自动打开浏览器（被客户端拉起时用）")
	flag.Parse()

	useTray := tray.Supported() && !*noTray
	if useTray || o.quiet {
		// GUI 构建没有控制台，日志只留文件
		if err := redirectLogToFile(o.dataDir); err == nil {
			log.SetFlags(log.LstdFlags)
		}
	}

	cfgStore, err := config.Open(o.dataDir)
	if err != nil {
		log.Fatalf("配置初始化失败: %v", err)
	}
	if err := applyOverrides(cfgStore, o); err != nil {
		log.Fatalf("应用启动参数失败: %v", err)
	}
	cfg := cfgStore.Get()

	authMgr := auth.New(cfgStore)
	ctrl := control.New(control.Options{DryRun: o.dryRun, DataDir: o.dataDir})
	sampler := metrics.NewSampler()
	acts := store.NewActivityStore(o.dataDir)

	sched, err := scheduler.New(o.dataDir, ctrl, makeExecutor(ctrl, acts))
	if err != nil {
		log.Printf("定时任务加载失败: %v", err)
	}

	api := httpapi.New(cfgStore, authMgr, ctrl, sampler, acts, sched, Version)

	node := discovery.Node{
		V: 1, ID: cfg.DeviceID, Name: cfg.DeviceName, Port: effectivePort(cfg),
		TLS: cfg.TLS.Enabled, Ver: Version, OS: runtime.GOOS, Arch: runtime.GOARCH,
	}
	ann, err := discovery.Start(node, !o.noMDNS)
	if err != nil {
		log.Printf("发现服务启动失败: %v", err)
	}

	sched.Start()
	metrics.WarmHardware()
	metrics.WarmUptime()

	addr := fmt.Sprintf("%s:%d", bindAddr(cfg, o), effectivePort(cfg))
	srv := &http.Server{
		Addr:              addr,
		Handler:           api.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		if !o.quiet {
			printBanner(cfgStore, authMgr, addr, !o.noMDNS)
		}
		var err error
		if cfg.TLS.Enabled && cfg.TLS.Cert != "" && cfg.TLS.Key != "" {
			err = srv.ListenAndServeTLS(cfg.TLS.Cert, cfg.TLS.Key)
		} else {
			err = srv.ListenAndServe()
		}
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("HTTP 服务启动失败（端口 %d 被占用？）: %v", effectivePort(cfg), err)
		}
	}()

	// 随手把配对信息写到数据目录，方便没有屏幕时用文件取码
	writePairingFile(cfgStore, authMgr)

	shutdown := make(chan struct{}, 1)

	if useTray {
		tray.SetConsoleURL(fmt.Sprintf("http://127.0.0.1:%d/", effectivePort(cfg)))
		tray.SetDataDir(o.dataDir)
		tray.Start(tray.Callbacks{
			Status: func() (string, string, int, string) {
				c := cfgStore.Get()
				code, _ := authMgr.Code()
				if !c.RandomEnabled {
					code = ""
				}
				return c.DeviceName, groupCode(code), len(c.Clients), ""
			},
			AutostartEnabled: autostartSelfEnabled,
			ToggleAutostart: func() (bool, error) {
				if autostartSelfEnabled() {
					if err := autostartSelfRemove(); err != nil {
						return false, err
					}
					return false, nil
				}
				if err := autostartSelfInstall(); err != nil {
					return false, err
				}
				return true, nil
			},
			OpenApp: openClientApp,
			OnQuit: func() {
				select {
				case shutdown <- struct{}{}:
				default:
				}
			},
		})
		if len(cfg.Clients) == 0 && !*noOpen {
			// 首次运行：直接把控制台页面打开，用户能立刻看到配对码。
			// --no-open 时不弹：桌面客户端自己就是控制台，弹浏览器只会吓人一跳。
			go openBrowser(fmt.Sprintf("http://127.0.0.1:%d/", effectivePort(cfg)))
		}
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	select {
	case <-stop:
	case <-shutdown:
	}
	log.Println("正在退出…")
	sched.Stop()
	if ann != nil {
		ann.Stop()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	acts.Close()
}

func bindAddr(cfg config.Config, o options) string {
	if o.bind != "" {
		return o.bind
	}
	if cfg.Bind != "" {
		return cfg.Bind
	}
	return "0.0.0.0"
}

func effectivePort(cfg config.Config) int {
	if cfg.Port <= 0 {
		return config.DefaultPort
	}
	return cfg.Port
}

func applyOverrides(st *config.Store, o options) error {
	return st.Update(func(c *config.Config) error {
		if o.port > 0 {
			c.Port = o.port
		}
		if o.bind != "" {
			c.Bind = o.bind
		}
		if o.name != "" {
			c.DeviceName = o.name
		}
		return nil
	})
}

func makeExecutor(ctrl control.Controller, acts *store.ActivityStore) func(scheduler.Task) error {
	return func(t scheduler.Task) error {
		var err error
		switch {
		case strings.HasPrefix(t.Action, "power."):
			delay := 0
			if v, ok := t.Params["delay"].(float64); ok {
				delay = int(v)
			}
			force, _ := t.Params["force"].(bool)
			err = ctrl.Power(strings.TrimPrefix(t.Action, "power."), delay, force)
		case strings.HasPrefix(t.Action, "volume."):
			value := 50
			if v, ok := t.Params["value"].(float64); ok {
				value = int(v)
			}
			_, err = ctrl.Volume(strings.TrimPrefix(t.Action, "volume."), value)
		case strings.HasPrefix(t.Action, "media."):
			err = ctrl.Media(strings.TrimPrefix(t.Action, "media."))
		default:
			err = control.ErrUnsupported
		}
		ok := err == nil
		detail := "定时任务执行成功"
		if err != nil {
			detail = err.Error()
		}
		acts.Add(store.Activity{
			ClientName: "定时任务",
			Action:     t.Name,
			OK:         ok,
			Detail:     detail,
			At:         time.Now().Format(time.RFC3339),
		})
		return err
	}
}

func printBanner(st *config.Store, a *auth.Manager, addr string, mdns bool) {
	cfg := st.Get()
	code, exp := a.Code()
	fmt.Println()
	fmt.Println("  LanDeck Agent " + Version)
	fmt.Println("  ─────────────────────────────────────────────")
	fmt.Printf("  设备名    : %s\n", cfg.DeviceName)
	fmt.Printf("  访问地址  : http://%s:%d  （或 http://%s.local:%d）\n", localIP(), effectivePort(cfg), hostSlug(cfg.DeviceName), effectivePort(cfg))
	fmt.Printf("  监听      : %s\n", addr)
	fmt.Printf("  固定密钥  : %s\n", cfg.FixedKey)
	if cfg.RandomEnabled {
		fmt.Printf("  随机码    : %s   （%s 过期，共 %ds）\n", code, exp.Format("15:04:05"), cfg.CodeTTL)
	}
	fmt.Printf("  已配对    : %d 台\n", len(cfg.Clients))
	fmt.Println("  ─────────────────────────────────────────────")
	fmt.Println()
}

func hostSlug(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-':
			b.WriteRune(r)
		case r == ' ' || r == '_' || r == '.':
			b.WriteByte('-')
		}
	}
	return strings.Trim(b.String(), "-")
}

func localIP() string {
	addrs, err := netInterfaces()
	if err != nil {
		return "127.0.0.1"
	}
	return addrs
}

// groupCode 把 6 位随机码分组成 3+3，便于口述。
func groupCode(code string) string {
	if len(code) != 6 {
		return code
	}
	return code[:3] + " " + code[3:]
}

// redirectLogToFile 把日志写进 data/agent.log（超过 2MB 轮转一次）。
func redirectLogToFile(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, "agent.log")
	if st, err := os.Stat(path); err == nil && st.Size() > 2<<20 {
		_ = os.Rename(path, filepath.Join(dir, "agent.log.1"))
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	log.SetOutput(f)
	return nil
}

func openBrowser(url string) {
	var err error
	switch runtime.GOOS {
	case "windows":
		err = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		err = exec.Command("open", url).Start()
	default:
		err = exec.Command("xdg-open", url).Start()
	}
	if err != nil {
		log.Printf("打开浏览器失败: %v", err)
	}
}

func writePairingFile(st *config.Store, a *auth.Manager) {
	code, exp := a.Code()
	cfg := st.Get()
	payload := map[string]any{
		"deviceId":   cfg.DeviceID,
		"deviceName": cfg.DeviceName,
		"port":       effectivePort(cfg),
		"fixedKey":   cfg.FixedKey,
		"randomCode": code,
		"codeExpiresAt": exp.Format(time.RFC3339),
		"updatedAt":  time.Now().Format(time.RFC3339),
	}
	raw, _ := json.MarshalIndent(payload, "", "  ")
	_ = os.WriteFile(filepath.Join(st.Dir(), "pairing.json"), append(raw, '\n'), 0o600)
}

// runMCPProxy 把 stdio 的 MCP 请求转发给本机 Agent，供 Claude Desktop 等客户端直接拉起。
func runMCPProxy(args []string) {
	fs := flag.NewFlagSet("mcp", flag.ExitOnError)
	host := fs.String("host", "127.0.0.1", "Agent 地址")
	port := fs.Int("port", config.DefaultPort, "Agent 端口")
	token := fs.String("token", os.Getenv("LANDECK_TOKEN"), "配对令牌（默认读 LANDECK_TOKEN）")
	_ = fs.Parse(args)
	if *token == "" {
		fmt.Fprintln(os.Stderr, "缺少 --token 或 LANDECK_TOKEN")
		os.Exit(2)
	}

	url := fmt.Sprintf("http://%s:%d/mcp", *host, *port)
	client := &http.Client{Timeout: 30 * time.Second}
	// MCP 是 JSON-RPC，逐行转发；响应也逐行回写。
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()

	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(line))
		if err != nil {
			continue
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+*token)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			fmt.Fprintf(out, `{"jsonrpc":"2.0","id":null,"error":{"code":-32000,"message":%q}}`+"\n", err.Error())
			out.Flush()
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if len(body) > 0 {
			out.Write(body)
			if body[len(body)-1] != '\n' {
				out.WriteByte('\n')
			}
			out.Flush()
		}
	}
}
