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

## Android 固定签名（重要）

APK 的签名**必须每次都用同一个 keystore**。否则 Android 会把每个版本当成不同的应用：
升级安装报「签名不一致」，只能先卸载（丢数据）再装。

CI 从仓库 Secrets 取固定 keystore，缺了就**直接失败**（不再像以前那样现生成一个）。

| Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | keystore 文件的 base64（`base64 -w0 release.keystore`） |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_ALIAS` | 密钥别名（默认 `landeck`） |

配置方式：

```bash
base64 -w0 app/src-tauri/gen/android/landeck-release.keystore | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD   # 交互输入
gh secret set ANDROID_KEY_ALIAS           # 交互输入，通常 landeck
```

keystore 本身在 `.gitignore` 里（`app/src-tauri/gen/android/*.keystore`），**不要入库**。

验证签名一致：

```bash
apksigner verify --print-certs app-release.apk | grep 'SHA-256 digest'
```

CI 会把这条指纹写进 `landeck-android-cert.txt` 一并上传，两个版本比一下就知道有没有变。
