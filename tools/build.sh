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
# 版本号从 agent/main.go 的 const Version 读取，不在构建脚本里再写一份。
# 之前这里硬编码 `-X main.Version=1.0.0`，会把本地构建的 agent 覆盖成 1.0.0，
# 而 CI 用的 LDFLAGS 不带这个覆盖 —— 同一份代码在两处报不同版本。
AGENT_VERSION=$(sed -n 's/^const Version = "\(.*\)"/\1/p' main.go | head -1)
if [ -z "$AGENT_VERSION" ]; then
  echo "   失败：无法从 agent/main.go 解析 Version" >&2
  exit 1
fi
LDFLAGS="-s -w -X main.Version=$AGENT_VERSION"
echo "   被控端版本 $AGENT_VERSION"
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

# Windows 产物自签名：消除「未知发布者」安全警告。
# 证书由 tools/sign-windows.ps1 -Setup 创建并信任（每台机器/用户一次）。
#
# 这里不吞错误、也不假装「跳过」成功：证书缺失是显式可见的 SKIP，
# 证书存在却签不上则直接让构建失败（之前用 2>/dev/null || echo 掩盖过
# 真实错误，报出来的是「跳过」而实际是脚本根本没能运行 —— 假绿）。
#
# 判定用 `case` 而不是 `[ "$x" = "PREFIX"* ]`：
#   在 POSIX test 的 `[ ]` 里，`*` 是**字面量**，不做通配展开，
#   所以原来的写法恒为假，Windows 上签名被静默跳过且没有任何输出 ——
#   正是上面那段注释想避免的「假绿」，只是换了个形式。
#   实测踩到：uname -s 返回 MINGW64_NT-10.0-19045，与 "MINGW64_NT" 不等，
#   构建「成功」但产物是 NotSigned。
OS_NAME=$(uname -s)
case "$OS_NAME" in
  MINGW*|MSYS*|CYGWIN*)
    if command -v powershell.exe >/dev/null 2>&1; then
      echo "== 签名 Windows 产物 =="
      # 用 $ROOT（脚本开头 cd 后算好的仓库根）而不是 $(dirname "$0")：
      # 开头已经 `cd "$(dirname "$0")/.."` 切到仓库根，此时 $0 仍是调用时的相对路径，
      # 再 dirname 一次会拼出 tools/tools/... 这种不存在的路径。
      # 实测踩到：修好平台判定后签名第一次真的执行，就报 sign-windows.ps1 does not exist。
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ROOT/tools/sign-windows.ps1"
      rc=$?
      if [ "$rc" -ne 0 ]; then
        echo "   签名失败（exit $rc）。证书未就绪时先运行：tools/sign-windows.ps1 -Setup" >&2
        exit "$rc"
      fi
    else
      echo "   跳过签名：未找到 powershell.exe" >&2
    fi
    ;;
  *)
    echo "== 跳过签名：当前平台 $OS_NAME 不是 Windows =="
    ;;
esac
