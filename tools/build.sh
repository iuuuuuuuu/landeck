#!/usr/bin/env bash
# 一键构建：前端 → 嵌入 Agent → 三平台二进制，产物统一放 agent/dist/
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)

echo "== 1/3 构建前端 =="
pnpm --dir web install --prefer-offline --silent
pnpm --dir web build
rm -rf agent/internal/webui/dist
mkdir -p agent/internal/webui/dist
cp -r web/dist/. agent/internal/webui/dist/
touch agent/internal/webui/dist/.gitkeep  # 保持 embed 目录在 git 里非空

TOTAL=$(du -sk agent/internal/webui/dist | cut -f1)
echo "   前端产物合计 ${TOTAL} KB"

# 门禁卡的是「首屏主包」，不是全部 chunk 之和：
# echarts 这类按需加载的独立 chunk 只会在打开对应页面时才下载，
# 拿总和去卡会把懒加载优化误判成超预算（之前 1449 KB 就是这么报错的）。
echo "== 2/3 体积门禁：首屏 JS+CSS ≤ 1200 KB =="
MAIN=$(find agent/internal/webui/dist/assets -maxdepth 1 -name 'index-*.js' -o -maxdepth 1 -name 'index-*.css' 2>/dev/null | xargs -r wc -c | tail -1 | awk '{print int($1/1024)}')
LAZY=$(find agent/internal/webui/dist/assets -maxdepth 1 -name '*.js' -o -maxdepth 1 -name '*.css' 2>/dev/null | grep -v '/index-' | xargs -r wc -c | tail -1 | awk '{print int($1/1024)}')
echo "   首屏 ${MAIN} KB · 懒加载 ${LAZY:-0} KB"
if [ "$MAIN" -gt 1200 ]; then
  echo "   失败：首屏产物 ${MAIN} KB 超出预算" >&2
  exit 1
fi

echo "== 3/3 编译三平台 Agent =="
mkdir -p agent/dist
cd agent
LDFLAGS="-s -w -X main.Version=1.0.0"
build() {
  local goos=$1 goarch=$2 out=$3
  GOOS=$goos GOARCH=$goarch CGO_ENABLED=0 go build -trimpath -ldflags "$LDFLAGS" -o "dist/$out" .
  local bytes
  bytes=$(wc -c < "dist/$out")
  local mb
  mb=$(awk -v b="$bytes" 'BEGIN { printf "%.2f", b / 1048576 }')
  echo "   $out  $mb MB"
  if [ "$bytes" -gt 15728640 ]; then
    echo "   失败：$out 超过 15 MB 预算" >&2
    exit 1
  fi
}
# 顺手刷新本机开发用二进制，避免 embed 到旧前端
go build -trimpath -ldflags "$LDFLAGS" -o bin/landeck-agent.exe .
echo "   本地开发二进制 bin/landeck-agent.exe 已刷新"

# Windows 主发行版是 GUI（托盘，无黑框）；再留一个 console 版便于排障
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$LDFLAGS -H windowsgui" -o dist/landeck-agent-windows-amd64.exe .
echo "   landeck-agent-windows-amd64.exe  (GUI/tray)  $(awk -v b=$(wc -c < dist/landeck-agent-windows-amd64.exe) 'BEGIN{printf "%.2f", b/1048576}') MB"
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$LDFLAGS" -o dist/landeck-agent-windows-amd64-console.exe .
echo "   landeck-agent-windows-amd64-console.exe  $(awk -v b=$(wc -c < dist/landeck-agent-windows-amd64-console.exe) 'BEGIN{printf "%.2f", b/1048576}') MB"
build linux   amd64 landeck-agent-linux-amd64
build linux   arm64 landeck-agent-linux-arm64
build darwin  arm64 landeck-agent-darwin-arm64
build darwin  amd64 landeck-agent-darwin-amd64

echo
echo "完成：agent/dist/"
ls -la dist
