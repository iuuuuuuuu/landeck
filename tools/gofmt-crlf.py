#!/usr/bin/env python3
"""CRLF 保持型 gofmt —— 全队格式化 .go 的唯一入口，裸 `gofmt -w` 禁止。

背景：gofmt 标准输出永远是 LF，而本仓库 .go 文件换行是双轨（部分 CRLF 部分 LF，
见 2026-10-31 的全队通报）。直接 `gofmt -w` 会把 CRLF 文件整体翻转成 LF，
产生「内容零差异」的全文件 diff，污染他人联调判断（本仓已发生两次）。

本包装记录每个文件的原 EOL，gofmt 后把输出转回原 EOL 再写盘——
diff 里永远只剩真实内容变更。

用法：
    python tools/gofmt-crlf.py <file.go> [more.go ...]
    python tools/gofmt-crlf.py internal/activity/*.go   # bash 通配

行为：
- 文件无格式变更时不写盘（mtime 不动）
- gofmt 语法错误时保留原文件、非零退出
"""
import subprocess
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    changed = 0
    for p in sys.argv[1:]:
        with open(p, "rb") as f:
            raw = f.read()
        was_crlf = b"\r\n" in raw
        r = subprocess.run(["gofmt", p], capture_output=True)
        if r.returncode != 0:
            sys.stderr.write(
                "gofmt failed: %s\n%s" % (p, r.stderr.decode("utf-8", errors="replace"))
            )
            return 1
        out = r.stdout
        if was_crlf:
            out = out.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
        if out != raw:
            with open(p, "wb") as f:
                f.write(out)
            print("formatted:", p)
            changed += 1
    if changed == 0:
        print("all formatted already")
    return 0


if __name__ == "__main__":
    sys.exit(main())
