//! 开机自启（跨平台，不引第三方 crate）。
//!
//! Windows：写 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
//! macOS：写 `~/Library/LaunchAgents/dev.landeck.app.plist`
//! Linux：写 `~/.config/autostart/landeck.desktop`
//!
//! 都放在用户级，不需要管理员权限；也不需要额外的系统服务。

use std::path::PathBuf;

const APP_ID: &str = "LanDeck";

fn exe_path() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| format!("拿不到自身路径：{e}"))
}

/// macOS launchd plist 的内容。
///
/// 为什么抽成纯函数、且**不放在 `#[cfg(macos)]` 里**：
/// 「开机自启要不要带 --silent」是跨平台一致的需求，但 Windows 机器上
/// 根本编译不到 macOS 那段代码，没法验证。抽出来之后在任何平台都能单测，
/// 否则这条逻辑只能靠「将来在 Mac 上试」—— 等于没验证。
pub(crate) fn macos_plist_body(exe: &str, silent: bool) -> String {
    // launchd 的 ProgramArguments 是 argv 数组：exe 自己是第 0 个，
    // 参数各自一个 <string>。silent 时追加一项。
    let args = if silent {
        format!("<string>{exe}</string><string>--silent</string>")
    } else {
        format!("<string>{exe}</string>")
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.landeck.app</string>
  <key>ProgramArguments</key><array>{args}</array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
"#
    )
}

/// Linux XDG autostart .desktop 的内容（同样理由抽成纯函数）。
pub(crate) fn linux_desktop_body(exe: &str, silent: bool) -> String {
    let exec = if silent {
        format!("\"{exe}\" --silent")
    } else {
        format!("\"{exe}\"")
    };
    format!(
        "[Desktop Entry]\nType=Application\nName=LanDeck\nExec={exec}\nX-GNOME-Autostart-enabled=true\n"
    )
}

#[cfg(windows)]
pub(crate) mod imp {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    /// 自启用「启动文件夹里的快捷方式」而不是注册表 Run 键。
    ///
    /// 实测：本机 HKCU\...\Run 的 KEY_SET_VALUE 被策略拒绝
    /// （RegOpenKeyExW 返回 ERROR_ACCESS_DENIED，连最小 Rust 程序都一样），
    /// 而 reg.exe 走的是另一条路径所以能成功 —— 依赖一个会因环境而异的旁路不稳妥。
    /// 启动文件夹是标准做法，且对用户可见可删（透明）。
    fn startup_dir() -> Result<PathBuf, String> {
        let appdata = std::env::var("APPDATA").map_err(|_| "没有 APPDATA 环境变量".to_string())?;
        Ok(PathBuf::from(appdata)
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs")
            .join("Startup"))
    }

    fn link_path_for(id: &str) -> Result<PathBuf, String> {
        Ok(startup_dir()?.join(format!("{id}.lnk")))
    }

    fn link_path() -> Result<PathBuf, String> {
        link_path_for(APP_ID)
    }

    /// 用 PowerShell 建 .lnk：Windows 没给 Rust 提供创建快捷方式的稳定 API，
    /// WScript.Shell 是系统自带、无依赖的标准做法。
    ///
    /// `silent` 决定快捷方式带不带 `--silent`：
    /// 带了就是开机后只进托盘、不弹窗口（用户要的"静默启动"）。
    /// 注意旧版本创建的自启项没有这个参数，用户升级后必须重写一次才生效 ——
    /// 所以 ui 层切换"静默"开关时会调用这里重写，而不是等用户重新开关自启。
    pub fn enable(silent: bool) -> Result<(), String> {
        enable_as(APP_ID, silent)
    }

    /// 用指定名字创建启动快捷方式。
    ///
    /// 存在的意义：单元测试要能验证 enable/disable 的真实行为，又**不能**碰
    /// 用户真正的开机自启项 —— 曾经因为测试直接写真名，把启动项指向了 cargo
    /// 测试二进制（`target/release/deps/landeck_lib-*.exe`），用户开机就会看到
    /// 「未知发布者」的安全警告。现在测试用自己的探针名，跑完即删。
    pub fn enable_as(id: &str, silent: bool) -> Result<(), String> {
        let exe = exe_path()?;
        let dir = startup_dir()?;
        fs::create_dir_all(&dir).map_err(|e| format!("创建启动文件夹失败：{e}"))?;
        create_link_at(&link_path_for(id)?, &exe, silent)
    }

    /// 在指定路径建快捷方式（真正的写 .lnk 逻辑）。
    ///
    /// 单独抽出来的原因：这是「静默启动」这条需求唯一需要被验证的地方，
    /// 但真正要写的 Startup 目录在受管机器/安全软件下可能被拒写
    /// （实测过 PowerShell 报 UnauthorizedAccessException）。
    /// 把路径参数化之后，测试可以写到临时目录，用**同一条代码路径**
    /// 验证 `--silent` 到底有没有写进去 —— 而不是因为环境拒绝写
    /// 就悄悄走「失败分支」把测试混成绿的（那是假绿）。
    pub fn create_link_at(link: &std::path::Path, exe: &std::path::Path, silent: bool) -> Result<(), String> {
        let args = if silent { "--silent" } else { "" };
        let working_dir = exe.parent().map(|p| p.display().to_string()).unwrap_or_default();
        let script = format!(
            "$ws = New-Object -ComObject WScript.Shell;              $s = $ws.CreateShortcut('{}');              $s.TargetPath = '{}';              $s.WorkingDirectory = '{}';              $s.Arguments = '{}';              $s.Save()",
            link.display(),
            exe.display(),
            working_dir,
            args
        );
        let out = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
            .output()
            .map_err(|e| format!("调用 PowerShell 失败：{e}"))?;
        if !out.status.success() || !link.exists() {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(format!("创建启动快捷方式失败：{err}"));
        }
        Ok(())
    }

    /// 读回某个 .lnk 的 Arguments（验证用）。
    pub fn read_link_args(link: &std::path::Path) -> String {
        let script = format!(
            "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('{}'); [Console]::Write($s.Arguments)",
            link.display()
        );
        match std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
            .output()
        {
            Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
            Err(_) => String::new(),
        }
    }

    pub fn disable() -> Result<(), String> {
        disable_as(APP_ID)
    }

    pub fn disable_as(id: &str) -> Result<(), String> {
        let link = link_path_for(id)?;
        if link.exists() {
            fs::remove_file(&link).map_err(|e| format!("删除启动快捷方式失败：{e}"))?;
        }
        Ok(())
    }

    pub fn is_enabled() -> bool {
        is_enabled_as(APP_ID)
    }

    pub fn is_enabled_as(id: &str) -> bool {
        link_path_for(id).map(|p| p.exists()).unwrap_or(false)
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use std::fs;

    fn plist_path() -> Result<PathBuf, String> {
        let home = std::env::var("HOME").map_err(|_| "没有 HOME 环境变量".to_string())?;
        Ok(PathBuf::from(home).join("Library/LaunchAgents/dev.landeck.app.plist"))
    }

    /// `silent` 决定 ProgramArguments 里带不带 `--silent`。
    ///
    /// 之前这里只写 exe 路径，所以 macOS 上开机自启**必然会弹窗口** ——
    /// 与 Windows 的行为不一致（Windows 早就传了 `--silent`）。
    pub fn enable(silent: bool) -> Result<(), String> {
        let exe = exe_path()?;
        let path = plist_path()?;
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("创建 LaunchAgents 失败：{e}"))?;
        }
        // launchd 的 ProgramArguments 是「argv 数组」：exe 自己算第 0 个，
        // 参数各自成一个 <string>。silent 时追加一项。
        let body = macos_plist_body(&exe.display().to_string(), silent);
        fs::write(&path, body).map_err(|e| format!("写 plist 失败：{e}"))?;
        let _ = std::process::Command::new("launchctl").args(["load", "-w"]).arg(&path).output();
        Ok(())
    }

    pub fn disable() -> Result<(), String> {
        let path = plist_path()?;
        let _ = std::process::Command::new("launchctl").args(["unload", "-w"]).arg(&path).output();
        let _ = fs::remove_file(path);
        Ok(())
    }

    pub fn is_enabled() -> bool {
        plist_path().map(|p| p.exists()).unwrap_or(false)
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
mod imp {
    use super::*;
    use std::fs;

    fn desktop_path() -> Result<PathBuf, String> {
        let home = std::env::var("HOME").map_err(|_| "没有 HOME 环境变量".to_string())?;
        Ok(PathBuf::from(home).join(".config/autostart/landeck.desktop"))
    }

    /// `silent` 决定 Exec 后面带不带 `--silent`（同 Windows/macOS 语义）。
    pub fn enable(silent: bool) -> Result<(), String> {
        let exe = exe_path()?;
        let path = desktop_path()?;
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("创建 autostart 目录失败：{e}"))?;
        }
        let body = linux_desktop_body(&exe.display().to_string(), silent);
        fs::write(&path, body).map_err(|e| format!("写 desktop 文件失败：{e}"))?;
        Ok(())
    }

    pub fn disable() -> Result<(), String> {
        let path = desktop_path()?;
        let _ = fs::remove_file(path);
        Ok(())
    }

    pub fn is_enabled() -> bool {
        desktop_path().map(|p| p.exists()).unwrap_or(false)
    }
}

pub use imp::{disable, enable, is_enabled};

