//! 应用偏好设置（主题等）的持久化。
//!
//! 为什么不只用 localStorage：Tauri 的 WebView2 数据目录在部分环境下会变
//! （多实例、调试参数、安装/升级路径不同），localStorage 随之清空 ——
//! 用户选了深色，重启后变回跟随系统，看起来就是「不记忆」。
//! 所以主题这类必须记住的偏好写到磁盘文件，由 Rust 侧保证位置稳定。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prefs {
    /// system | dark | light
    #[serde(default = "default_mode")]
    pub theme: String,
    /// 窗口几何：记住用户拖过的大小和位置
    #[serde(default)]
    pub window: WindowPrefs,
    /// 开机自启时是否静默启动（不显示窗口，直接进托盘）。
    ///
    /// 默认 true：开机自启的本意就是"在后台候着"，弹一个窗口出来是打扰。
    /// 老版本用户没有这个字段，`serde(default)` 会让它取 true ——
    /// 也就是升级后默认就是静默，符合用户预期。
    #[serde(default = "default_true")]
    pub silent_autostart: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WindowPrefs {
    #[serde(default)]
    pub width: f64,
    #[serde(default)]
    pub height: f64,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub maximized: bool,
    /// 是否已经存过一次（避免 0x0 被当成有效尺寸）
    #[serde(default)]
    pub saved: bool,
}

fn default_mode() -> String {
    "system".to_string()
}

fn default_true() -> bool {
    true
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            theme: default_mode(),
            window: WindowPrefs::default(),
            silent_autostart: true,
        }
    }
}

/// 偏好文件位置：按优先级依次尝试，第一个能写的目录胜出。
///
/// 为什么不写死一个：真实安装环境下 app_local_data_dir 最合适；
/// 但实测某些受管机器会拒绝 App 进程写 AppData（同样的路径 shell 能建），
/// 便携版也不该硬依赖系统目录。所以做成链路，而不是赌单一路径。
fn candidate_dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
    use tauri::Manager;
    let mut dirs = Vec::new();

    if let Ok(p) = app.path().app_local_data_dir() {
        dirs.push(p);
    }
    // 便携版：可执行文件旁的 data 目录
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.join("data"));
        }
    }
    // 最后兜底：系统临时目录（一定可写）
    dirs.push(std::env::temp_dir().join("lan-deck"));

    dirs
}

/// 选中第一个真正可写的目录，并在其中创建 prefs.json 的路径。
fn prefs_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut last_err = String::from("没有可用的配置目录");
    for dir in candidate_dirs(app) {
        if fs::create_dir_all(&dir).is_err() {
            continue;
        }
        let probe = dir.join(".write-probe");
        match fs::write(&probe, b"ok") {
            Ok(()) => {
                let _ = fs::remove_file(&probe);
                return Ok(dir.join("prefs.json"));
            }
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(format!("没有可写的配置目录：{last_err}"))
}

pub fn load(app: &tauri::AppHandle) -> Prefs {
    match prefs_path(app) {
        Ok(p) => match fs::read_to_string(&p) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
            Err(_) => Prefs::default(),
        },
        Err(_) => Prefs::default(),
    }
}

pub fn save(app: &tauri::AppHandle, prefs: &Prefs) -> Result<(), String> {
    let path = prefs_path(app)?;
    let text = serde_json::to_string_pretty(prefs).map_err(|e| format!("序列化失败：{e}"))?;
    // 先写临时文件再重命名：避免写一半断电留下坏文件
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| format!("写偏好失败：{e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("保存偏好失败：{e}"))?;
    Ok(())
}
