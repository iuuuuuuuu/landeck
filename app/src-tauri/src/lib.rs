//! LanDeck 控制端（Tauri v2）。
//! 壳只做三件事：给 SPA 一个窗口、提供原生 UDP 广播发现、处理外部链接。
//! 其余逻辑全部在 web/ 里复用，保证和浏览器入口完全一致。

mod autostart;
mod prefs;

use serde::Serialize;
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::time::{Duration, Instant};

#[derive(Serialize)]
struct Node {
    v: u32,
    id: String,
    name: String,
    ip: String,
    port: u16,
    tls: bool,
    ver: String,
    os: String,
    arch: String,
    paired: bool,
}

/// 发现端口，与 Agent 的 UDP 应答端口一致。
const DISCOVERY_PORT: u16 = 8421;

/// 等应答的时长：安卓上要发 254 份单播、手机 Wi-Fi 上行慢，多给一点时间。
#[cfg(target_os = "android")]
const LISTEN_MS: u64 = 2000;
#[cfg(not(target_os = "android"))]
const LISTEN_MS: u64 = 900;

/// 判断是不是「用户真正连着的局域网」私有 IPv4。
/// 排除环回、链路本地（169.254，安卓没拿到 DHCP 时常见）、以及运营商 CGNAT 段
/// （100.64/10，安卓蜂窝网常见）—— 后两种扫出来的网段里不可能有用户的 PC。
fn usable_lan_ip(ip: Ipv4Addr) -> bool {
    if ip.is_loopback() || ip.is_link_local() || ip.is_broadcast() || ip.is_unspecified() {
        return false;
    }
    let o = ip.octets();
    if o[0] == 100 && (64..=127).contains(&o[1]) {
        return false;
    }
    ip.is_private()
}

/// 给网卡打分：分越高越可能是「用户实际连着的那个局域网」。
///
/// 安卓上同时存在好几块网卡：wlan0（Wi-Fi，常见 192.168.x.x）、rmnet_data0（蜂窝，
/// 私有段 10.x）、tun0（VPN）……只取「第一个私有地址」时经常拿到蜂窝的运营商内网地址，
/// 于是扫的是 10.x 的运营商网段，同网段的 PC 一台都扫不到。
fn iface_rank(name: &str, ip: Ipv4Addr) -> i32 {
    let n = name.to_ascii_lowercase();
    let mut score = 0i32;

    // 蜂窝 / 点对点隧道 / 虚拟网卡先罚分，别让它们抢走首选
    for k in ["rmnet", "ccmni", "ccni", "seth", "pdp", "wwan", "clat", "cell"] {
        if n.contains(k) {
            score -= 100;
            break;
        }
    }
    // ZeroTier / Tailscale / WireGuard 这类"看着像普通网卡、其实是隧道"的要一并罚分。
    // 实测踩到：本机装了 ZeroTier，网卡名 "ZeroTier One [id]"，地址是 192.168.x.y，
    // 命中下面 192.168 的加分后反超了真正的以太网，导致 local_ip 返回 VPN 地址。
    for k in [
        "zerotier", "tailscale", "wireguard", "wintun", "openvpn", "nordlynx", "hamachi",
        "radmin", "pptp", "l2tp", "sstp", "vpn",
    ] {
        if n.contains(k) {
            score -= 80;
            break;
        }
    }
    for k in ["tun", "tap", "ppp", "ipsec", "utun", "ip6tnl"] {
        if n.contains(k) {
            score -= 60;
            break;
        }
    }
    for k in [
        "wsl", "vethernet", "virtual", "vmware", "vbox", "virbr", "docker", "veth", "br-",
        "bridge",
    ] {
        if n.contains(k) {
            score -= 40;
            break;
        }
    }

    // Wi-Fi 才是手机能扫到同网段 PC 的唯一通道
    for k in ["wlan", "wifi", "wi-fi", "swlan", "wlp", "ap0"] {
        if n.contains(k) {
            score += 100;
            break;
        }
    }
    // 有线网卡（桌面 / 电视盒子 / 部分安卓盒子）
    if n.starts_with("eth")
        || n.starts_with("en")
        || n.starts_with("em")
        || n.starts_with("ethernet")
        // Windows 中文系统的有线网卡叫「以太网」「以太网 2」，纯英文前缀匹配会漏掉
        || name.contains("以太网")
        || name.contains("本地连接")
    {
        score += 20;
    }

    // 不再按网段加分：曾经给 192.168.x 加 +30（"家用路由器大多在这段"），
    // 结果 ZeroTier 的 192.168.x.y 反超真实以太网的 10.x.y.z。
    // 网段是"猜测"，网卡类型才是证据，只保留基于网卡名的判断。
    let _ = ip;
    score
}

/// 本机所有可用局域网 IPv4：(网卡名, 地址, 掩码)
fn lan_ifaces() -> Vec<(String, Ipv4Addr, Ipv4Addr)> {
    let mut out: Vec<(String, Ipv4Addr, Ipv4Addr)> = Vec::new();
    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for iface in ifaces {
            if iface.is_loopback() {
                continue;
            }
            if let if_addrs::IfAddr::V4(v4) = iface.addr {
                if usable_lan_ip(v4.ip) {
                    out.push((iface.name.clone(), v4.ip, v4.netmask));
                }
            }
        }
    }
    out
}

/// 首选局域网网卡：安卓上是 Wi-Fi 地址，桌面端是有线/Wi-Fi 地址。
/// 扫哪个 /24、UDP 从哪块网卡出去，全看它。
fn preferred_lan_iface() -> Option<(String, Ipv4Addr, Ipv4Addr)> {
    let mut best: Option<(i32, (String, Ipv4Addr, Ipv4Addr))> = None;
    for item in lan_ifaces() {
        let score = iface_rank(&item.0, item.1);
        if best.as_ref().map_or(true, |(s, _)| score > *s) {
            best = Some((score, item));
        }
    }
    best.map(|(_, item)| item)
}

/// 某个地址所在 /24 里除自己以外的全部主机地址（与前端扫段用的是同一个 /24）
#[allow(dead_code)]
fn slash24_hosts(ip: Ipv4Addr) -> Vec<Ipv4Addr> {
    let o = ip.octets();
    let mut out: Vec<Ipv4Addr> = Vec::with_capacity(254);
    for i in 1..=254u8 {
        if i == o[3] {
            continue;
        }
        out.push(Ipv4Addr::new(o[0], o[1], o[2], i));
    }
    out
}

/// 本机真实设备信息。
///
/// 为什么需要原生：WebView 里 `navigator.deviceMemory` 是**分档近似值**（上限 8），
/// `hardwareConcurrency` 在安卓上常年被钳在 4 —— 用户 16GB / 16 核的机器会被显示成
/// 8GB / 4 核，属于"数据不准"。这里改读系统真值：
///   · 内存：/proc/meminfo 的 MemTotal（安卓 / Linux 通用）
///   · 系统版本/机型：`getprop`（安卓自带二进制）
///   · 核心数：available_parallelism（真实可用核心）
#[derive(serde::Serialize, Default)]
struct DeviceProfile {
    os: String,
    os_version: String,
    model: String,
    vendor: String,
    /// 内存总量（MB，整数；拿不到为 0）
    mem_total_mb: u64,
    cpu_cores: u32,
    /// 诊断：内存是从哪条路径拿到的（meminfo / activity_manager / none）。
    /// 界面据此决定要不要显示「系统限制，读不到」，而不是含糊地空着。
    mem_source: String,
}

#[cfg(target_os = "android")]
fn android_getprop(key: &str) -> String {
    std::process::Command::new("getprop")
        .arg(key)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// Windows：GlobalMemoryStatusEx 拿物理内存总量（MB）。
/// 之前只读 /proc/meminfo，Windows 上恒为 0，桌面端「本机」页内存一直是空的。
#[cfg(windows)]
fn mem_total_mb() -> u64 {
    #[repr(C)]
    #[allow(non_snake_case)]
    struct MEMORYSTATUSEX {
        dwLength: u32,
        dwMemoryLoad: u32,
        ullTotalPhys: u64,
        ullAvailPhys: u64,
        ullTotalPageFile: u64,
        ullAvailPageFile: u64,
        ullTotalVirtual: u64,
        ullAvailVirtual: u64,
        ullAvailExtendedVirtual: u64,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalMemoryStatusEx(lpBuffer: *mut MEMORYSTATUSEX) -> i32;
    }
    let mut st = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        dwMemoryLoad: 0,
        ullTotalPhys: 0,
        ullAvailPhys: 0,
        ullTotalPageFile: 0,
        ullAvailPageFile: 0,
        ullTotalVirtual: 0,
        ullAvailVirtual: 0,
        ullAvailExtendedVirtual: 0,
    };
    // SAFETY: 结构体已按 Win32 ABI 布局，dwLength 为自身大小，指针仅在本调用内使用。
    let ok = unsafe { GlobalMemoryStatusEx(&mut st) };
    if ok == 0 {
        return 0;
    }
    st.ullTotalPhys / (1024 * 1024)
}

#[cfg(not(windows))]
fn mem_total_mb() -> u64 {
    // 路径一：/proc/meminfo（桌面 / Linux 通用）。
    // 安卓 10+ 上该文件 SELinux 标签是 proc_meminfo，untrusted_app 通常读不到，
    // 所以下面还有路径二。
    let txt = match std::fs::read_to_string("/proc/meminfo") {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[LanDeck] 读 /proc/meminfo 失败：{e}");
            String::new()
        }
    };
    for line in txt.lines() {
        if let Some(rest) = line.strip_prefix("MemTotal:") {
            if let Some(kb) = rest.split_whitespace().next() {
                if let Ok(kb) = kb.parse::<u64>() {
                    return kb / 1024;
                }
            }
        }
    }
    // 读不到就返回 0：前端会如实显示「系统限制，读不到」，
    // 绝不拿浏览器分档值（上限 8GB）冒充 16GB 的真实容量。
    0
}

/// 读 MainActivity 写下的系统真值（安卓）。
///
/// 交接方式：Kotlin 用 ActivityManager.MemoryInfo 拿到权威内存，写进应用私有目录的
/// device_profile.json；这里按包名拼出同一路径读回来。
/// 拿不到就返回 None，由调用方回落 —— 不编造数字。
#[cfg(target_os = "android")]
fn read_android_profile_file() -> Option<serde_json::Value> {
    // 多路径尝试：不同 Android 版本上 /data/data/<pkg> 与 /data/user/0/<pkg>
    // 有一个会是可读的软链。硬编码单条路径曾在真机上直接失败（EPERM），
    // 而读不到时界面只会显示空值 —— 所以这里把所有候选都试一遍。
    let candidates = [
        "/data/user/0/dev.landeck.app/files/device_profile.json",
        "/data/data/dev.landeck.app/files/device_profile.json",
        // filesDir 的另一种布局（部分 ROM / 多用户场景）
        "/data/user/10/dev.landeck.app/files/device_profile.json",
    ];
    for path in candidates {
        match std::fs::read_to_string(path) {
            Ok(txt) => {
                if let Ok(v) = serde_json::from_str(&txt) {
                    return Some(v);
                }
            }
            Err(e) => {
                eprintln!("[LanDeck] profile 路径不可读 {path}: {e}");
            }
        }
    }
    None
}

#[tauri::command]
fn device_profile() -> DeviceProfile {
    let mut p = DeviceProfile {
        cpu_cores: std::thread::available_parallelism().map(|n| n.get() as u32).unwrap_or(0),
        mem_total_mb: mem_total_mb(),
        ..Default::default()
    };
    if p.mem_total_mb > 0 {
        p.mem_source = "meminfo".into();
    } else {
        p.mem_source = "none".into();
    }

    #[cfg(target_os = "android")]
    {
        p.os = "android".into();
        p.os_version = android_getprop("ro.build.version.release");
        p.model = android_getprop("ro.product.model");
        p.vendor = android_getprop("ro.product.manufacturer");

        // 系统真值优先：内存只有 ActivityManager 准（/proc/meminfo 被 SELinux 拦）
        if let Some(v) = read_android_profile_file() {
            if let Some(mb) = v.get("mem_total_mb").and_then(|x| x.as_u64()) {
                if mb > 0 {
                    p.mem_total_mb = mb;
                    p.mem_source = "activity_manager".into();
                }
            }
            if p.model.is_empty() {
                if let Some(m) = v.get("model").and_then(|x| x.as_str()) {
                    p.model = m.to_string();
                }
            }
            if p.vendor.is_empty() {
                if let Some(m) = v.get("vendor").and_then(|x| x.as_str()) {
                    p.vendor = m.to_string();
                }
            }
            if p.os_version.is_empty() {
                if let Some(m) = v.get("os_version").and_then(|x| x.as_str()) {
                    p.os_version = m.to_string();
                }
            }
        }
    }
    #[cfg(target_os = "ios")]
    {
        p.os = "ios".into();
    }
    #[cfg(all(not(target_os = "android"), not(target_os = "ios")))]
    {
        p.os = std::env::consts::OS.to_string();
        p.os_version = String::new();
    }
    eprintln!(
        "[LanDeck] device_profile: os={} ver={} model={} mem={}MB cores={}",
        p.os, p.os_version, p.model, p.mem_total_mb, p.cpu_cores
    );
    p
}

/// 扫描时 UDP socket 绑哪个本机地址。
/// 安卓必须绑 Wi-Fi 地址，强制收发都走 Wi-Fi 口；否则包会从蜂窝口出去，
/// 发到一个跟 PC 毫不相干的网段（「手机扫不到 PC」的根因之一）。
#[cfg(target_os = "android")]
fn scan_bind_ip(preferred: Option<Ipv4Addr>) -> Ipv4Addr {
    preferred.unwrap_or(Ipv4Addr::UNSPECIFIED)
}

/// 桌面 / iOS 保持原样：绑 0.0.0.0，多网卡都能收。
#[cfg(not(target_os = "android"))]
fn scan_bind_ip(_preferred: Option<Ipv4Addr>) -> Ipv4Addr {
    Ipv4Addr::UNSPECIFIED
}

/// 广播之外还要逐台单播探测的地址列表。
/// 安卓在没拿 WifiManager.MulticastLock 时，Wi-Fi 省电策略会丢广播和组播，
/// 所以安卓额外对 Wi-Fi 网段逐台发单播（Agent 的回包本来就是 unicast 回给探测方）。
#[cfg(target_os = "android")]
fn unicast_sweep(preferred: Option<Ipv4Addr>) -> Vec<Ipv4Addr> {
    preferred.map(slash24_hosts).unwrap_or_default()
}

#[cfg(not(target_os = "android"))]
fn unicast_sweep(_preferred: Option<Ipv4Addr>) -> Vec<Ipv4Addr> {
    Vec::new()
}

/// 扫描局域网内的 Agent：先发 UDP 探测包，再收应答。
/// 端口固定 8421（与 Agent 的发现端口一致）。
///
/// 为什么必须 `spawn_blocking`：
///   这个函数内部有 LISTEN_MS（安卓 2000ms / 桌面 900ms）的阻塞接收循环。
///   原来写成普通同步 `#[tauri::command]`，Tauri 会在 **WebView 主线程**上执行它，
///   实测后果：点扫描后主线程被占满 2302ms —— 雷达的 CSS 扫描动画
///   （本来走合成层、与 JS 无关）直接停住不动，切页也卡死。
///   真机 CDP profile 里那 3 秒多的 `(anon) @ :0`（无源码位置 = 原生）就是它。
///
///   只把 fn 改成 async 还不够：async fn 里的阻塞代码仍然占住 executor 线程。
///   必须用 spawn_blocking 把它挪到专门的阻塞线程池，主线程与 async 调度器都不受影响。
#[tauri::command]
async fn scan_lan() -> Vec<Node> {
    // 阻塞的 UDP 收发放到阻塞线程池，主线程立即返回、继续渲染动画
    match tauri::async_runtime::spawn_blocking(scan_lan_blocking).await {
        Ok(v) => v,
        Err(_) => Vec::new(),
    }
}

fn scan_lan_blocking() -> Vec<Node> {
    let mut out: Vec<Node> = Vec::new();

    // 首选网卡决定两件事：socket 绑哪、单播扫哪个 /24
    let preferred = preferred_lan_iface();
    let preferred_ip = preferred.as_ref().map(|(_, ip, _)| *ip);
    let bind = SocketAddrV4::new(scan_bind_ip(preferred_ip), 0);
    let socket = UdpSocket::bind(bind)
        .or_else(|_| UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0)));
    let socket = match socket {
        Ok(s) => s,
        Err(_) => return out,
    };
    // 广播必须显式打开，否则 send_to(255.255.255.255) 直接 EACCES
    let _ = socket.set_broadcast(true);
    let _ = socket.set_read_timeout(Some(Duration::from_millis(200)));

    // 目标一：全局广播 + 每块网卡的定向广播（多网段/VPN 时更可靠）
    let mut targets: Vec<SocketAddrV4> =
        vec![SocketAddrV4::new(Ipv4Addr::BROADCAST, DISCOVERY_PORT)];
    for (_, ip, mask) in lan_ifaces() {
        let net = u32::from(ip);
        let m = u32::from(mask);
        let bcast = Ipv4Addr::from(net | !m);
        let addr = SocketAddrV4::new(bcast, DISCOVERY_PORT);
        if !targets.contains(&addr) {
            targets.push(addr);
        }
    }

    // 目标二（仅安卓）：Wi-Fi 网段逐台单播，绕开安卓丢广播的省电策略
    for host in unicast_sweep(preferred_ip) {
        targets.push(SocketAddrV4::new(host, DISCOVERY_PORT));
    }

    let probe = b"LANDECK_DISCOVER_V1";

    let deadline = Instant::now() + Duration::from_millis(LISTEN_MS);
    let mut buf = [0u8; 2048];
    let mut rounds = 0u8;
    // 发一轮、收一会儿、再发一轮：UDP 无连接且会丢包，重发比开线程简单也够用。
    while Instant::now() < deadline {
        if rounds < 3 {
            for t in &targets {
                let _ = socket.send_to(probe, *t);
            }
            rounds += 1;
        }
        match socket.recv_from(&mut buf) {
            Ok((n, from)) => {
                if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&buf[..n]) {
                    let get_str = |k: &str| value.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let id = get_str("id");
                    if id.is_empty() || out.iter().any(|x| x.id == id) {
                        continue;
                    }
                    out.push(Node {
                        v: value.get("v").and_then(|v| v.as_u64()).unwrap_or(1) as u32,
                        id,
                        name: get_str("name"),
                        ip: {
                            let ip = get_str("ip");
                            if ip.is_empty() { from.ip().to_string() } else { ip }
                        },
                        port: value.get("port").and_then(|v| v.as_u64()).unwrap_or(8420) as u16,
                        tls: value.get("tls").and_then(|v| v.as_bool()).unwrap_or(false),
                        ver: get_str("ver"),
                        os: get_str("os"),
                        arch: get_str("arch"),
                        paired: value.get("paired").and_then(|v| v.as_bool()).unwrap_or(false),
                    });
                }
            }
            Err(_) => continue,
        }
    }
    out
}

/// 本机被控端状态：端口上有没有人应答。
#[cfg(desktop)]
#[tauri::command]
fn agent_status(port: u16) -> bool {
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

/// 启动随客户端附带的被控端（安装包里带了 landeck-agent.exe）。
///
/// 为什么把 agent 打进客户端安装包：用户在一台新电脑上只装了客户端，
/// 打开「本机」页看到的却是「设备离线」—— 因为那台机器根本没有被控端。
/// 与其让他再去下载第二个安装包，不如随客户端带一份，一键启用。
#[cfg(desktop)]
#[tauri::command]
fn agent_start(app: tauri::AppHandle, port: u16) -> Result<bool, String> {
    agent_start_impl(&app, port)
}

/// 移动端：没有本地被控端可拉起
#[cfg(mobile)]
#[tauri::command]
fn agent_status(_port: u16) -> bool {
    false
}

#[cfg(mobile)]
#[tauri::command]
fn agent_start(_app: tauri::AppHandle, _port: u16) -> Result<bool, String> {
    Err("手机上不能启动本机被控端".into())
}

#[cfg(desktop)]
fn agent_start_impl(app: &tauri::AppHandle, port: u16) -> Result<bool, String> {
    use std::process::Command;
    use tauri::Manager;

    if agent_status(port) {
        return Ok(true); // 已经在跑
    }

    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("拿不到资源目录：{e}"))?;

    // Tauri 打包后资源可能落在 resources/ 子目录下，两处都找
    let exe_name = if cfg!(windows) { "landeck-agent.exe" } else { "landeck-agent" };
    let candidates = [
        dir.join("resources").join(exe_name),
        dir.join(exe_name),
        // 兼容旧布局
        dir.join("resources").join("landeck-agent.exe"),
        dir.join("landeck-agent.exe"),
    ];
    let exe = candidates
        .iter()
        .find(|p| p.exists())
        .ok_or_else(|| format!("安装包里没找到被控端（找过 {}）", dir.display()))?;

    // 数据目录放在客户端自己的数据目录下，避免与手动安装的 Agent 抢配置
    let data = dir.join("agent-data");
    let _ = std::fs::create_dir_all(&data);

    let mut cmd = Command::new(exe);
    cmd.arg("--data").arg(&data);
    // 客户端自己就是控制台；被控端再弹一个浏览器会让人以为装错了
    cmd.arg("--no-open");
    // 关键：客户端自己已经有托盘图标了，被控端再挂一个就是两个图标。
    // 用户明确要求「一个就够了」，所以由客户端启动的被控端一律不建托盘。
    cmd.arg("--no-tray");
    if port != 8420 {
        cmd.arg("--port").arg(port.to_string());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW，别弹黑框
    }
    cmd.spawn().map_err(|e| format!("启动被控端失败：{e}"))?;

    // 给进程一点启动时间再回报状态
    std::thread::sleep(std::time::Duration::from_millis(900));
    Ok(agent_status(port))
}

#[tauri::command]
fn platform() -> String {
    std::env::consts::OS.to_string()
}

/// 返回本机的私有 IPv4，供前端推导要扫的网段。
/// Tauri 里页面 hostname 是 tauri.localhost，前端拿不到内网地址，必须由原生层提供。
///
/// 安卓上必须挑 Wi-Fi 那块网卡：蜂窝（rmnet，10.x）和 VPN（tun）也有私有地址，
/// 谁先被遍历到就返回谁的话，前端会去扫运营商内网段，同网段的 PC 一台都扫不到。
/// 本机正在运行的 Agent 的 id（用于把它从扫描结果里排掉）。
///
/// 为什么不放前端 fetch：安卓 WebView 里对 http://<私网IP>:8420 的请求可能被
/// 混合内容/明文策略拦下，挂到超时才返回，整轮扫描被拖慢；而且每个候选端口都要试一遍。
/// 原生侧直接发一次 UDP 探测 + 解析回包，最快也最稳。
/// 本机 Agent 的 id（用于在扫描结果里排除「我自己」）。
///
/// 必须 async + spawn_blocking：内部有 600ms 的阻塞 UDP 接收循环，
/// 外加 `preferred_lan_iface()` 的网卡枚举（114~140ms）。
/// 同步版会在 WebView 主线程上跑满 700ms+，而扫描流程一开始就会调它。
#[tauri::command]
async fn self_agent_id() -> Option<String> {
    tauri::async_runtime::spawn_blocking(self_agent_id_blocking)
        .await
        .ok()
        .flatten()
}

fn self_agent_id_blocking() -> Option<String> {
    let preferred = preferred_lan_iface();
    let ip = preferred.map(|(_, ip, _)| ip);
    let bind = SocketAddrV4::new(scan_bind_ip(ip), 0);
    let socket = UdpSocket::bind(bind).ok()?;
    let _ = socket.set_broadcast(true);
    let _ = socket.set_read_timeout(Some(Duration::from_millis(400)));

    // 先问 loopback，再问本机网卡地址：哪个有回包就取它的 id
    let mut targets = vec![SocketAddrV4::new(Ipv4Addr::LOCALHOST, DISCOVERY_PORT)];
    if let Some(ip) = ip {
        targets.push(SocketAddrV4::new(ip, DISCOVERY_PORT));
    }
    let probe = b"LANDECK_DISCOVER_V1";
    let mut buf = [0u8; 2048];
    for t in targets {
        let _ = socket.send_to(probe, t);
    }
    let deadline = Instant::now() + Duration::from_millis(600);
    while Instant::now() < deadline {
        if let Ok((n, _)) = socket.recv_from(&mut buf) {
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&buf[..n]) {
                if let Some(id) = v.get("id").and_then(|x| x.as_str()) {
                    if !id.is_empty() {
                        return Some(id.to_string());
                    }
                }
            }
        }
    }
    None
}

/// 本机在局域网里的 IPv4。
///
/// 必须 async + spawn_blocking：`preferred_lan_iface()` 内部会枚举网卡
/// （`if_addrs::get_if_addrs` / `net.Interfaces` 等价物），Windows 上实测
/// 单次 114~140ms。原来写成同步 `#[tauri::command]`，Tauri 会在 WebView
/// 主线程执行 —— 而扫描流程一开始就会调它（nativeLocalIP），
/// 于是「点扫描」的第一下就卡住，雷达动画随之停住。
#[tauri::command]
async fn local_ip() -> Option<String> {
    tauri::async_runtime::spawn_blocking(local_ip_blocking)
        .await
        .ok()
        .flatten()
}

fn local_ip_blocking() -> Option<String> {
    if let Some((_, ip, _)) = preferred_lan_iface() {
        return Some(ip.to_string());
    }
    // 一个像样的私有地址都没有（极少见：只连了蜂窝 CGNAT / 只有 IPv6）：
    // 兜底返回任意一个非环回 IPv4，前端自己会过滤非法值。
    let ifaces = if_addrs::get_if_addrs().ok()?;
    for iface in ifaces {
        if iface.is_loopback() {
            continue;
        }
        if let if_addrs::IfAddr::V4(v4) = iface.addr {
            return Some(v4.ip.to_string());
        }
    }
    None
}

/// 开机自启：Windows 写 HKCU\...\Run，macOS 写 LaunchAgent，Linux 写 XDG autostart。
/// 读主题偏好（system | dark | light）
#[tauri::command]
fn theme_get(app: tauri::AppHandle) -> String {
    prefs::load(&app).theme
}

/// 写主题偏好。桌面端持久化到磁盘，不依赖 WebView 的 localStorage。
#[tauri::command]
fn theme_set(app: tauri::AppHandle, mode: String) -> Result<String, String> {
    let mode = match mode.as_str() {
        "dark" | "light" | "system" => mode,
        other => return Err(format!("未知主题：{other}")),
    };
    let mut p = prefs::load(&app);
    p.theme = mode.clone();
    prefs::save(&app, &p)?;
    Ok(mode)
}

#[tauri::command]
fn autostart_get() -> bool {
    autostart::is_enabled()
}

#[tauri::command]
fn autostart_set(enabled: bool) -> Result<bool, String> {
    if enabled {
        autostart::enable()?;
    } else {
        autostart::disable()?;
    }
    Ok(autostart::is_enabled())
}

/// 窗口行为：恢复上次尺寸/位置、关闭时隐藏而不是销毁、--silent 静默启动。
///
/// 为什么关闭要 hide 而不是 destroy：Tauri 关窗默认销毁 webview，
/// 从托盘再打开就是**重建**，页面状态、滚动位置、正在看的设备全丢，
/// 用户看到的就是"重新访问了一遍"。
#[cfg(desktop)]
fn setup_window(app: &mut tauri::App) {
    use tauri::{Manager, WindowEvent};

    let silent = std::env::args().any(|a| a == "--silent");
    let saved = prefs::load(app.handle()).window;

    if let Some(win) = app.get_webview_window("main") {
        if saved.saved && saved.width > 320.0 && saved.height > 240.0 {
            let _ = win.set_size(tauri::LogicalSize::new(saved.width, saved.height));
            if saved.x > -32000.0 && saved.y > -32000.0 {
                let _ = win.set_position(tauri::LogicalPosition::new(saved.x, saved.y));
            }
            if saved.maximized {
                let _ = win.maximize();
            }
        }
        if silent {
            // 开机自启：直接缩到托盘，不弹窗
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }

    let handle = app.handle().clone();
    if let Some(win) = app.get_webview_window("main") {
        win.on_window_event(move |event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                // 关窗 = 收进托盘，进程和页面都留着
                api.prevent_close();
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            WindowEvent::Resized(_) | WindowEvent::Moved(_) => save_window_geometry(&handle),
            _ => {}
        });
    }
}

/// 记录当前窗口几何。最大化时存还原尺寸（否则下次恢复出来是个全屏卡住的窗口）。
#[cfg(desktop)]
fn save_window_geometry(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    if win.is_minimized().unwrap_or(false) {
        return;
    }
    let maximized = win.is_maximized().unwrap_or(false);
    if maximized {
        // 最大化状态下只更新标记，尺寸沿用上次的还原值
        let mut p = prefs::load(app);
        if p.window.maximized {
            return;
        }
        p.window.maximized = true;
        let _ = prefs::save(app, &p);
        return;
    }
    let (Ok(size), Ok(pos)) = (win.inner_size(), win.outer_position()) else {
        return;
    };
    let scale = win.scale_factor().unwrap_or(1.0);
    let mut p = prefs::load(app);
    p.window = prefs::WindowPrefs {
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
        x: pos.x as f64 / scale,
        y: pos.y as f64 / scale,
        maximized: false,
        saved: true,
    };
    let _ = prefs::save(app, &p);
}

#[cfg(desktop)]
/// 托盘图标：装在任务栏通知区，关掉窗口后也能重新叫出来。
///
/// 为什么需要：用户反馈「装完之后没有托盘」—— 桌面客户端之前确实没有，
/// 只有被控端 Agent 有托盘。控制端关窗后就没有任何入口，只能去开始菜单重开。
fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::Manager;
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "打开 LanDeck", true, None::<&str>)?;
    let local = MenuItem::with_id(app, "local", "本机状态", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &local, &quit])?;

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;

    // 关键：build() 返回的 TrayIcon 必须保活。直接丢弃返回值 = 图标立刻被移除，
    // 表现就是「装完没有托盘」。挂到 app state 里由 Tauri 管理生命周期。
    let tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("LanDeck 控制端")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "local" => show_main_at(app, "/local"),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 左键单击：直接显示窗口（比"弹出菜单再点一次"少一步）
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    app.manage(tray);
    Ok(())
}

#[cfg(desktop)]
fn show_main(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[cfg(desktop)]
fn show_main_at(app: &tauri::AppHandle, path: &str) {
    use tauri::Manager;
    show_main(app);
    if let Some(win) = app.get_webview_window("main") {
        // 前端用 HashRouter，改 hash 即可切页
        let js = format!("location.hash = '{path}'");
        let _ = win.eval(&js);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            setup_tray(app)?;
            #[cfg(desktop)]
            setup_window(app);
            // 随客户端自动启动本机被控端：用户装完就能在本机页看到数据，
            // 不必再去点一次「启动」。失败不影响客户端本身。
            #[cfg(desktop)]
            {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                match agent_start_impl(&handle, 8420) {
                    Ok(true) => eprintln!("[LanDeck] 本机被控端已就绪"),
                    Ok(false) => eprintln!("[LanDeck] 本机被控端未就绪（可能端口被占）"),
                    Err(e) => eprintln!("[LanDeck] 启动本机被控端失败：{e}"),
                }
            });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            device_profile,
            scan_lan,
            platform,
            local_ip,
            self_agent_id,
            autostart_get,
            autostart_set,
            theme_get,
            theme_set,
            agent_status,
            agent_start
        ])
        .run(tauri::generate_context!())
        .expect("LanDeck 启动失败");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 实机验证：本机必须能解析出私有 IPv4（Tauri 里前端靠它推导网段）。
    #[test]
    fn local_ip_returns_private_v4() {
        let ip = local_ip().expect("本机应至少有一个私有 IPv4");
        let o: Vec<u8> = ip.split('.').map(|p| p.parse().unwrap()).collect();
        assert_eq!(o.len(), 4, "不是点分四段: {ip}");
        let private = o[0] == 10
            || (o[0] == 172 && (16..=31).contains(&o[1]))
            || (o[0] == 192 && o[1] == 168);
        assert!(private, "返回的不是私有地址: {ip}");
        println!("local_ip = {ip}");

        // 只断言「是私有地址」太弱：ZeroTier 的 192.168.192.x 也是私有地址，
        // 当初就是这条弱断言让「local_ip 返回 VPN 地址」的 bug 溜过去了。
        // 真正的判据是「这个地址必须属于一块非隧道/非虚拟的物理网卡」。
        let winner = preferred_lan_iface().expect("应有首选网卡");
        let name = winner.0.to_ascii_lowercase();
        for bad in ["zerotier", "tailscale", "wireguard", "wintun", "vethernet", "virtual", "vpn"] {
            assert!(
                !name.contains(bad),
                "首选网卡是隧道/虚拟网卡（{name} → {ip}），应选真实局域网网卡"
            );
        }
        println!("首选网卡 = {} ({})", winner.0, winner.1);
    }

    /// 实机验证：自启开关的行为。
    ///
    /// 注意：这台开发机上有安全软件会拦截「非交互进程创建自启项」，
    /// 所以这里不强制要求 enable 成功 —— 但要区分两种情况：
    ///   a) 被拦截：必须给出明确错误（不能静默失败），测试通过；
    ///   b) 没被拦截：必须真的写进去、真的删掉。
    /// 两者都不允许「返回 Ok 但实际没生效」。
    #[test]
    fn autostart_roundtrip() {
        // 用**独立探针名**跑，绝不碰用户真实的自启动项。
        // 历史教训：这个测试曾经直接操作真名，把启动项指向了 cargo 测试二进制
        // （target/release/deps/landeck_lib-*.exe），导致用户开机看到
        // 「未知发布者」的安全警告，且极难联想到是测试留下的。
        #[cfg(windows)]
        {
            use crate::autostart::imp;
            const PROBE: &str = "LanDeckTestProbe";
            let _ = imp::disable_as(PROBE); // 清掉上次残留
            assert!(!imp::is_enabled_as(PROBE), "起点应为未启用");
            match imp::enable_as(PROBE) {
                Ok(()) => {
                    assert!(imp::is_enabled_as(PROBE), "enable 返回成功但状态没变 —— 假成功");
                    imp::disable_as(PROBE).expect("关闭失败");
                    assert!(!imp::is_enabled_as(PROBE), "disable 后仍存在 —— 假关闭");
                    println!("autostart roundtrip ok（探针名 {PROBE}，已清理）");
                }
                Err(e) => {
                    assert!(!e.is_empty(), "失败必须给出原因");
                    let _ = imp::disable_as(PROBE);
                    println!("autostart 被环境拦截（已正确上报错误）：{e}");
                }
            }
            // 真实自启动项的状态不受本次测试影响
            println!("真实自启动项当前状态 = {}", crate::autostart::is_enabled());
        }
        #[cfg(not(windows))]
        {
            println!("autostart roundtrip: 非 Windows 平台跳过探针写入（避免动真实自启项）");
        }
    }

    /// 实机验证：UDP 广播必须能发现同网段正在运行的 Agent。
    /// 需要本机 Agent 在跑；没有则跳过（但会打印明确原因，不静默通过）。
    #[test]
    fn scan_lan_finds_local_agent() {
        // 测试里直接调阻塞版本：命令入口是 async + spawn_blocking，
        // 但那层包装只是为了让 UI 线程不被占住，探测逻辑本身仍是同步的。
        let nodes = scan_lan_blocking();
        println!("发现 {} 台设备", nodes.len());
        for n in &nodes {
            println!("  {} {} {}:{}", n.name, n.os, n.ip, n.port);
        }
        if nodes.is_empty() {
            // 用 HTTP 直连再确认一次：区分「广播不通」与「Agent 没跑」
            let http_ok = std::net::TcpStream::connect_timeout(
                &"127.0.0.1:8420".parse().unwrap(),
                Duration::from_millis(500),
            )
            .is_ok();
            assert!(!http_ok, "Agent 在 8420 上可用，但 UDP 广播没发现它 —— 广播链路有问题");
            println!("跳过：本机 8420 没有 Agent 在跑，无法验证广播");
        } else {
            assert!(nodes.iter().all(|n| !n.id.is_empty() && n.port > 0));
        }
    }
}
