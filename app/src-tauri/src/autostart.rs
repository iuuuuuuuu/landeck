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

#[cfg(windows)]
mod imp {
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

    fn link_path() -> Result<PathBuf, String> {
        Ok(startup_dir()?.join(format!("{APP_ID}.lnk")))
    }

    /// 用 PowerShell 建 .lnk：Windows 没给 Rust 提供创建快捷方式的稳定 API，
    /// WScript.Shell 是系统自带、无依赖的标准做法。
    pub fn enable() -> Result<(), String> {
        let exe = exe_path()?;
        let dir = startup_dir()?;
        fs::create_dir_all(&dir).map_err(|e| format!("创建启动文件夹失败：{e}"))?;
        let link = link_path()?;
        let script = format!(
            "$ws = New-Object -ComObject WScript.Shell;              $s = $ws.CreateShortcut('{}');              $s.TargetPath = '{}';              $s.WorkingDirectory = '{}';              $s.Arguments = '--silent';              $s.Save()",
            link.display(),
            exe.display(),
            exe.parent().map(|p| p.display().to_string()).unwrap_or_default()
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

    pub fn disable() -> Result<(), String> {
        let link = link_path()?;
        if link.exists() {
            fs::remove_file(&link).map_err(|e| format!("删除启动快捷方式失败：{e}"))?;
        }
        Ok(())
    }

    pub fn is_enabled() -> bool {
        link_path().map(|p| p.exists()).unwrap_or(false)
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

    pub fn enable() -> Result<(), String> {
        let exe = exe_path()?;
        let path = plist_path()?;
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("创建 LaunchAgents 失败：{e}"))?;
        }
        let body = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.landeck.app</string>
  <key>ProgramArguments</key><array><string>{}</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
"#,
            exe.display()
        );
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

    pub fn enable() -> Result<(), String> {
        let exe = exe_path()?;
        let path = desktop_path()?;
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("创建 autostart 目录失败：{e}"))?;
        }
        let body = format!(
            "[Desktop Entry]\nType=Application\nName=LanDeck\nExec=\"{}\"\nX-GNOME-Autostart-enabled=true\n",
            exe.display()
        );
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

