# 构建与发布

三平台 Agent、前端、桌面安装包、Android APK 分别在哪构建、谁产出什么。

## 为什么不能一台机器全出

| 产物 | 能在 Windows 上出吗 | 原因 |
| --- | --- | --- |
| Agent（win/linux/mac） | ✅ | Go 交叉编译，`CGO_ENABLED=0` |
| Web UI | ✅ | Vite 构建，与平台无关 |
| Windows 安装包（msi/nsis） | ✅ | WiX / NSIS 在 Windows 上可用 |
| **macOS 安装包（dmg/app）** | ❌ | `.app` 打包、签名、`hdiutil` 造 dmg 都只能跑在 macOS 上 |
| Android APK | ✅ | Gradle + NDK 在 Windows 上可用 |

所以：**macOS 的 App 安装包必须由 macOS 机器产出**。本地开发机是 Windows，这一步交给 CI 的 `macos-latest` runner。

## 本地产出（Windows）

```bash
bash tools/build.sh          # 前端 + 五平台 Agent → agent/dist/
cd app && pnpm tauri build   # Windows msi/nsis（在 Windows 上）
```

## CI 产出（`.github/workflows/release.yml`）

打 tag 时自动跑：

- `build-desktop`（windows-latest）：Windows msi + nsis
- `build-desktop`（macos-latest）：macOS dmg（Intel + Apple Silicon 各一份）
- `build-desktop`（ubuntu-22.04）：deb + AppImage
- `build-android`（ubuntu-latest）：universal APK
- `build-agent`（ubuntu-latest）：五个平台的 Agent 二进制

产物汇总到一个 draft release，人工确认后发布。

### macOS 未签名说明

CI 上没有 Apple Developer 证书，产出的 dmg **未签名、未公证**。用户首次打开需要：

```bash
xattr -dr com.apple.quarantine /Applications/LanDeck.app
```

或「系统设置 → 隐私与安全性 → 仍要打开」。要出正式签名版，需要在仓库 Secrets 里配
`APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` / `APPLE_ID` /
`APPLE_PASSWORD` / `APPLE_TEAM_ID`，Tauri 会自动识别并签名+公证。

## 本地验证

```bash
node tools/smoke.mjs --base http://<ip>:8420     # 前端冒烟（真浏览器 + 真 Agent）
node tools/desktop-check.mjs                      # 桌面端 CDP 自检（需先开调试端口）
cd app/src-tauri && cargo test --release          # 原生层单测（本机 IP / UDP 发现 / 自启）
```
