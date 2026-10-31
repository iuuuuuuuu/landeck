package memory

// OCR 常驻 worker（Windows）：一个长驻 PowerShell 进程，stdin 收 PNG 路径、
// stdout 回 JSON 行（textB64 + lang）。
//
// 为什么从「按次起进程」改成常驻：实测同参数同时刻，pwsh 进程内跑 WinRT OCR
// 稳定出文本，而按次拉起的 PowerShell 子进程会随机返回空结果（WinRT 的
// 会话状态相关，详见交付说明）。长驻还有个红利：WinRT 初始化一次，
// 每张图省 300ms-1s 的进程/投影启动成本。
//
// 代价：worker 常驻 ~60-80MB（仅在功能开启时存在；关闭/停止即杀）。
// 协议：每行一个绝对路径；一行 JSON 回应；顺序严格对应；45s 超时杀进程重启。

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
)

const ocrTimeout = 45 * time.Second

type ocrResult struct {
	TextB64 string `json:"textB64"`
	Lang    string `json:"lang"`
	// Err 脚本内单张图失败的原因（不影响 worker 存活）；非空时 Text 为空
	Err string `json:"err,omitempty"`
}

// Text 还原 OCR 文本（脚本输出 BASE64，规避 PS5.1 stdout 编码漂移）。
func (r ocrResult) Text() string {
	raw, err := base64.StdEncoding.DecodeString(r.TextB64)
	if err != nil {
		return ""
	}
	return string(raw)
}

type ocrRunner struct {
	mu     sync.Mutex
	ps1    string
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Scanner
}

// ensure 启动 worker（幂等）。失败返回错误，调用方计数 ocrFail。
func (r *ocrRunner) ensure() error {
	if r.cmd != nil {
		// 进程若已退出（崩溃），清掉重起
		if r.cmd.ProcessState == nil {
			return nil
		}
		r.kill()
	}
	cmd := exec.Command("powershell.exe",
		"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-File", r.ps1)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = nil // 诊断标记丢弃（线上）；排障时临时改 CombinedOutput
	if err := cmd.Start(); err != nil {
		return err
	}
	r.cmd, r.stdin, r.stdout = cmd, stdin, bufio.NewScanner(stdout)
	r.stdout.Buffer(make([]byte, 0, 64*1024), 4*1024*1024) // OCR 文本可能很长
	return nil
}

func (r *ocrRunner) kill() {
	if r.cmd != nil && r.cmd.Process != nil {
		_ = r.cmd.Process.Kill()
		_ = r.cmd.Wait()
	}
	r.cmd, r.stdin, r.stdout = nil, nil, nil
}

// run 对一张 PNG 做 OCR。任何失败返回 error；调用方重启语义由 ensure 兜底。
func (r *ocrRunner) run(pngPath string) (ocrResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.ensure(); err != nil {
		return ocrResult{}, err
	}

	type res struct {
		line string
		err  error
	}
	done := make(chan res, 1)
	go func() {
		if _, err := fmt.Fprintln(r.stdin, pngPath); err != nil {
			done <- res{err: err}
			return
		}
		if !r.stdout.Scan() {
			done <- res{err: fmt.Errorf("OCR worker 无响应（已退出）")}
			return
		}
		done <- res{line: strings.TrimSpace(r.stdout.Text())}
	}()

	var out res
	select {
	case out = <-done:
	case <-time.After(ocrTimeout):
		r.kill() // 超时杀掉，下次 ensure 重起
		return ocrResult{}, fmt.Errorf("OCR 超时（%v）", ocrTimeout)
	}
	if out.err != nil {
		return ocrResult{}, out.err
	}
	line := strings.TrimPrefix(out.line, "\ufeff") // PS 可能带 BOM
	if line == "NOLANG" {
		return ocrResult{}, nil // 无语言包：文本空，非错误
	}
	if strings.HasPrefix(line, "OCRERR") {
		return ocrResult{}, fmt.Errorf("OCR 脚本错误: %s", strings.TrimSpace(strings.TrimPrefix(line, "OCRERR")))
	}
	var r2 ocrResult
	if err := json.Unmarshal([]byte(line), &r2); err != nil {
		return ocrResult{}, fmt.Errorf("OCR 输出解析失败: %w", err)
	}
	if r2.Err != "" {
		return ocrResult{}, fmt.Errorf("OCR 识别失败: %s", r2.Err)
	}
	return r2, nil
}

func (r *ocrRunner) close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cmd != nil && r.stdin != nil {
		_, _ = io.WriteString(r.stdin, "EXIT\n")
		time.Sleep(200 * time.Millisecond) // 给它优雅退出的机会
	}
	r.kill()
}
