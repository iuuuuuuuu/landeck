# Agent Note: 发布流水线两处必红（macOS 签名、Android SDK 冲突）

Status: implemented

## Problem

`.github/workflows/release.yml` 第一次真正跑起来，`macos-latest` 与 Android 两个 job 都红了，
`汇总发布` 因此被 skip —— 也就是说一个产物都没出来。

两处失败互不相关：

1. **macOS**：`failed to import the signing certificate as a PKCS#12 (.p12) file`。
   工作流把 `APPLE_CERTIFICATE` 等六个 secret 直接写进 `env:`。GitHub Actions 里
   **未配置的 secret 会展开成空字符串，但变量依然存在**；Tauri 只要看到变量存在就当作
   「要签名」，于是拿空内容去 `security import`，必然失败。
2. **Android**：`Several environment variables ... contain different paths to the SDK`。
   runner（ubuntu-latest）预装了 Android SDK 并设了 `ANDROID_SDK_ROOT=/usr/local/lib/android/sdk`，
   而我又下载了一份到 `$HOME/android-sdk` 并导出 `ANDROID_HOME` —— 两套路径同时存在，Gradle 直接拒绝。

## Decision

1. macOS 拆成两步构建，用 job 级 env 判断有没有证书：
   ```yaml
   env:
     HAS_APPLE_CERT: ${{ secrets.APPLE_CERTIFICATE != '' }}
   ```
   `HAS_APPLE_CERT != 'true'` 走「未签名」分支（完全不注入 `APPLE_*`），
   `== 'true'` 才注入六个签名变量。没证书时产出可用的未签名 dmg，不再假装能签名。
2. Android 不再自带 SDK，**用 runner 预装的那套**，只补 NDK：
   `SDK=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/usr/local/lib/android/sdk}}`，
   装 `ndk;27.0.12077973` 并导出 `NDK_HOME` / `ANDROID_NDK_ROOT`，**不设 `ANDROID_HOME`**。

## Alternatives considered

- **在仓库 Secrets 里填一个假证书**：能骗过 import，但产出的包签名无效，
  以后真配证书时还会踩同一个坑。放弃。
- **给 macOS job 加 `continue-on-error: true`**：红变黄，产物缺失却看起来"通过"，
  正是本项目明令禁止的假绿。放弃。
- **Android 干脆全用自己下载的 SDK，并 unset `ANDROID_SDK_ROOT`**：可行，但每次 CI 多花一两分钟
  重复下载 runner 已经装好的东西，且版本会与 runner 漂移。放弃。
- **把 Android 构建挪到本地**：本机 Windows 能出 APK，但 CI 就覆盖不到这条链路，
  以后 Android 侧改动没人守。放弃。

## 追加：不要用 draft release

第一次真跑通后发现了第三个问题：`release` job 用了 `draft: true`，于是**产物齐全但用户看不到** ——
GitHub 上只有一条 draft，必须手动去后台点「发布」才会出现。用户的第一反应是「报错了，都没发版」。

改成 `draft: false` + `prerelease: true`：打 tag 即产出**立即可见**的预发布版，
既符合「未经批准只发预测试版」的规矩，也不会让人以为没发出去。

顺带修了校验和的自包含 bug：`sha256sum * > SHA256SUMS.txt` 里重定向先创建空文件，
`*` 展开时把它也含进去，等于给一个空文件算哈希。现在先 `rm -f` 再算。

## Consequences

收益：两个 job 都能出产物；macOS 在没证书时给出「未签名」的明确结果而不是失败；
Android 复用 runner 缓存，跑得更快。

代价：
- macOS 未签名包首次打开需要 `xattr -dr com.apple.quarantine`，这点写进了 `docs/BUILD.md`。
- `HAS_APPLE_CERT` 依赖 `secrets.APPLE_CERTIFICATE != ''` 的表达式，只在 job 级 `env` 生效；
  若挪到 step 级要重新验证（GitHub 对 `if:` 里直接用 `secrets` 有限制）。
- 这两条都是**在 CI 上验证的**，本地 Windows 无法复现 macOS 打包与 Android SDK 冲突 ——
  所以修完必须再打一次 tag 看绿灯，不能只凭"改对了"就宣布完成。
