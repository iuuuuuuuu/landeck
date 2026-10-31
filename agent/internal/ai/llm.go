package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ChatMessage 与 provider 无关的消息（前端/内部统一形状）。
type ChatMessage struct {
	Role    string `json:"role"` // system | user | assistant
	Content string `json:"content"`
}

// httpClient 可注入：单测用 httptest 假 server 替换，生产用默认。
// 为什么不用包级函数直接发：注入点越浅，"provider 错误透传"这类门禁越好写。
var httpClient = &http.Client{Timeout: 90 * time.Second}

// chat 调 LLM 拿一段文本。错误携带 provider 与状态码，handler 原样透传给前端。
func chat(ctx context.Context, cfg Config, messages []ChatMessage) (string, error) {
	if len(messages) == 0 {
		return "", fmt.Errorf("消息为空")
	}
	var (
		url     string
		body    any
		extract func([]byte) (string, error)
	)
	if cfg.Provider == ProviderOllama {
		url = cfg.BaseURL + "/api/chat"
		body = map[string]any{
			"model":    cfg.Model,
			"messages": messages,
			"stream":   false,
		}
		extract = func(b []byte) (string, error) {
			var out struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			}
			if err := json.Unmarshal(b, &out); err != nil {
				return "", fmt.Errorf("ollama 响应解析失败: %w", err)
			}
			return out.Message.Content, nil
		}
	} else {
		// OpenAI 兼容：官方与中转/本地推理（vLLM、LM Studio 等）都是这个形状。
		url = cfg.BaseURL + "/chat/completions"
		body = map[string]any{
			"model":    cfg.Model,
			"messages": messages,
			"stream":   false,
		}
		extract = func(b []byte) (string, error) {
			var out struct {
				Choices []struct {
					Message struct {
						Content string `json:"content"`
					} `json:"message"`
				} `json:"choices"`
				Error *struct {
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal(b, &out); err != nil {
				return "", fmt.Errorf("openai 响应解析失败: %w", err)
			}
			if out.Error != nil && out.Error.Message != "" {
				return "", fmt.Errorf("provider 错误: %s", out.Error.Message)
			}
			if len(out.Choices) == 0 {
				return "", fmt.Errorf("openai 响应没有 choices")
			}
			return out.Choices[0].Message.Content, nil
		}
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if cfg.Provider == ProviderOpenAI && cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("调用 %s 失败: %w", cfg.Provider, err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return "", fmt.Errorf("读取 provider 响应失败: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		// 错误透传：保留状态码与响应片段（截断），前端才能提示「key 错了」「模型不存在」这类具体原因。
		snippet := strings.TrimSpace(string(b))
		if len(snippet) > 300 {
			snippet = snippet[:300]
		}
		return "", fmt.Errorf("%s 返回 %d: %s", cfg.Provider, resp.StatusCode, snippet)
	}
	content, err := extract(b)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(content) == "" {
		return "", fmt.Errorf("%s 返回了空内容", cfg.Provider)
	}
	return content, nil
}
