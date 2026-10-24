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

SIZE=$(du -sk agent/internal/webui/dist | cut -f1)
echo "   前端产物 ${SIZE} KB（gzip 后约 $((SIZE / 4)) KB）"

echo "== 2/3 体积门禁：前端 ≤ 1200 KB =="
if [ "$SIZE" -gt 1200 ]; then
  echo "   失败：前端产物 ${SIZE} KB 超出预算" >&2
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
