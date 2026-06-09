use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::{
    fs,
    io::{self, Read, Seek, SeekFrom, Write},
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket},
    path::{Component, Path, PathBuf},
    process::Command as StdCommand,
    sync::{Arc, Mutex},
    thread,
    time::UNIX_EPOCH,
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

const SHARE_SHELL_TEMPLATE: &str = include_str!("../templates/share_shell.html");
const APLAYER_CSS: &[u8] = include_bytes!("../vendor/aplayer/APlayer.min.css");
const APLAYER_JS: &[u8] = include_bytes!("../vendor/aplayer/APlayer.min.js");
const APP_CONFIG_DIR: &str = "oFinder";
const APP_CONFIG_FILE: &str = "config.json";

struct AppState {
    fallback_root: PathBuf,
    share_root: Arc<Mutex<PathBuf>>,
    share_port: Arc<Mutex<Option<u16>>>,
    ocserver_child: Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>,
    ocserver_port: Arc<Mutex<Option<u16>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
    name: String,
    path: String,
    absolute_path: String,
    entry_type: String,
    kind: String,
    mime: Option<String>,
    size: Option<u64>,
    children: Option<usize>,
    modified_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Breadcrumb {
    name: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryListing {
    root: String,
    path: String,
    name: String,
    breadcrumbs: Vec<Breadcrumb>,
    entries: Vec<FileEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModulesListing {
    root: String,
    modules: Vec<FileEntry>,
    total: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShareInfo {
    root: String,
    port: u16,
    local_url: String,
    lan_urls: Vec<String>,
}

#[derive(Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    share_port: Option<u16>,
    share_port_locked: bool,
    #[serde(default, skip_serializing)]
    locked_share_port: Option<u16>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImagePreviewItem {
    path: String,
    name: String,
    preview_url: String,
    full_url: String,
    page_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicPreviewItem {
    path: String,
    name: String,
    artist: String,
    url: String,
}

const INTERNAL_ROOT_DIRS: &[&str] = &[
    ".git",
    ".codex",
    ".agents",
    ".finder-cache",
    "node_modules",
    "src-tauri",
    "dist",
    "src",
];

fn default_root() -> PathBuf {
    std::env::current_dir().unwrap_or_else(|_| {
        dirs::home_dir().unwrap_or_else(|| {
            if cfg!(target_os = "windows") {
                PathBuf::from("C:\\")
            } else {
                PathBuf::from("/")
            }
        })
    })
}

fn app_config_path() -> PathBuf {
    dirs::config_dir()
        .or_else(dirs::data_local_dir)
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_CONFIG_DIR)
        .join(APP_CONFIG_FILE)
}

fn read_app_config() -> AppConfig {
    let path = app_config_path();
    let mut config: AppConfig = fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();

    if config.share_port.is_none() && config.locked_share_port.is_some() {
        config.share_port = config.locked_share_port;
        config.share_port_locked = true;
    }
    config
}

fn write_app_config(config: &AppConfig) -> Result<(), String> {
    let path = app_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(path, text).map_err(|error| error.to_string())
}

fn normalize_relative_path(input: Option<String>) -> Result<String, String> {
    let raw = input.unwrap_or_default().replace('\\', "/");
    let raw = raw.trim_start_matches('/');
    let mut parts = Vec::new();

    for component in Path::new(raw).components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
            Component::CurDir => {}
            Component::ParentDir => return Err("Invalid path.".into()),
            _ => return Err("Invalid path.".into()),
        }
    }

    Ok(parts.join("/"))
}

fn resolve_root(root: Option<String>, state: &AppState) -> PathBuf {
    root.map(PathBuf::from)
        .unwrap_or_else(|| state.fallback_root.clone())
}

fn resolve_path(root: &Path, rel_path: Option<String>) -> Result<(String, PathBuf), String> {
    let rel_path = normalize_relative_path(rel_path)?;
    let full_path = if rel_path.is_empty() {
        root.to_path_buf()
    } else {
        root.join(&rel_path)
    };
    let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
    let canonical_path = full_path
        .canonicalize()
        .map_err(|error| error.to_string())?;

    if canonical_path != canonical_root && !canonical_path.starts_with(&canonical_root) {
        return Err("Path escapes root.".into());
    }

    Ok((rel_path, canonical_path))
}

fn is_blocked_root_name(name: &str) -> bool {
    name.starts_with('.') || INTERNAL_ROOT_DIRS.contains(&name)
}

fn modified_seconds(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn join_rel(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

fn kind_for(path: &Path, mime: &str) -> String {
    if is_music_extension(path) {
        "music".into()
    } else if mime.starts_with("image/") {
        "image".into()
    } else if mime.starts_with("audio/") {
        "audio".into()
    } else if mime.starts_with("video/") {
        "video".into()
    } else if mime == "application/pdf" {
        "pdf".into()
    } else if mime.starts_with("text/") || is_text_extension(path) {
        "text".into()
    } else {
        "binary".into()
    }
}

fn is_music_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "mp3" | "mp4"
    )
}

fn is_text_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "c" | "conf"
            | "cpp"
            | "css"
            | "csv"
            | "go"
            | "h"
            | "html"
            | "ini"
            | "java"
            | "js"
            | "json"
            | "jsx"
            | "log"
            | "lua"
            | "md"
            | "php"
            | "py"
            | "rb"
            | "rs"
            | "sh"
            | "sql"
            | "swift"
            | "toml"
            | "ts"
            | "tsx"
            | "txt"
            | "vue"
            | "xml"
            | "yaml"
            | "yml"
    )
}

fn is_resizable_image(path: &Path, mime: &str) -> bool {
    if !mime.starts_with("image/") {
        return false;
    }

    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "bmp" | "jpeg" | "jpg" | "png" | "tif" | "tiff" | "webp"
    )
}

fn count_visible_children(path: &Path) -> usize {
    fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
                .count()
        })
        .unwrap_or(0)
}

fn entry_from_path(parent_rel: &str, path: PathBuf) -> Option<FileEntry> {
    let name = path.file_name()?.to_string_lossy().to_string();
    if name.starts_with('.') {
        return None;
    }

    if parent_rel.is_empty() && is_blocked_root_name(&name) {
        return None;
    }

    let metadata = fs::metadata(&path).ok()?;
    let is_dir = metadata.is_dir();
    let is_file = metadata.is_file();

    if !is_dir && !is_file {
        return None;
    }

    let mime = if is_file {
        Some(
            mime_guess::from_path(&path)
                .first_or_octet_stream()
                .to_string(),
        )
    } else {
        None
    };
    let rel_path = join_rel(parent_rel, &name);
    let kind = if is_dir {
        "directory".into()
    } else {
        kind_for(&path, mime.as_deref().unwrap_or("application/octet-stream"))
    };

    Some(FileEntry {
        name,
        path: rel_path,
        absolute_path: path.to_string_lossy().to_string(),
        entry_type: if is_dir { "directory" } else { "file" }.into(),
        kind,
        mime,
        size: if is_file { Some(metadata.len()) } else { None },
        children: if is_dir {
            Some(count_visible_children(&path))
        } else {
            None
        },
        modified_at: modified_seconds(&metadata),
    })
}

fn sort_entries(entries: &mut [FileEntry]) {
    entries.sort_by(|a, b| {
        if a.entry_type != b.entry_type {
            return if a.entry_type == "directory" {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }

        natord::compare_ignore_case(&a.name, &b.name)
    });
}

fn list_directory_inner(root: &Path, rel_path: Option<String>) -> Result<DirectoryListing, String> {
    let (rel_path, full_path) = resolve_path(root, rel_path)?;
    if !full_path.is_dir() {
        return Err("Path is not a directory.".into());
    }

    let mut entries: Vec<FileEntry> = fs::read_dir(&full_path)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| entry_from_path(&rel_path, entry.path()))
        .collect();

    sort_entries(&mut entries);

    let name = if rel_path.is_empty() {
        root.file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "首页".into())
    } else {
        full_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "目录".into())
    };

    Ok(DirectoryListing {
        root: root.to_string_lossy().to_string(),
        path: rel_path.clone(),
        name,
        breadcrumbs: breadcrumbs_for(&rel_path),
        entries,
    })
}

fn list_root_modules_inner(root: &Path) -> Result<Vec<FileEntry>, String> {
    Ok(list_directory_inner(root, None)?
        .entries
        .into_iter()
        .filter(|entry| entry.entry_type == "directory")
        .collect())
}

fn breadcrumbs_for(rel_path: &str) -> Vec<Breadcrumb> {
    let mut crumbs = vec![Breadcrumb {
        name: "首页".into(),
        path: "".into(),
    }];
    let mut current = String::new();

    for segment in rel_path.split('/').filter(|segment| !segment.is_empty()) {
        current = join_rel(&current, segment);
        crumbs.push(Breadcrumb {
            name: segment.into(),
            path: current.clone(),
        });
    }

    crumbs
}

fn asset_url(path: &Path) -> String {
    format!(
        "asset://localhost/{}",
        urlencoding::encode(&path.to_string_lossy())
    )
}

fn is_private_ipv4(address: Ipv4Addr) -> bool {
    let parts = address.octets();
    parts[0] == 10
        || (parts[0] == 172 && (16..=31).contains(&parts[1]))
        || (parts[0] == 192 && parts[1] == 168)
}

fn lan_addresses() -> Vec<Ipv4Addr> {
    let mut addresses = Vec::new();

    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = StdCommand::new("/sbin/ifconfig").output() {
            let text = String::from_utf8_lossy(&output.stdout);
            for token in text.split_whitespace().collect::<Vec<_>>().windows(2) {
                if token[0] == "inet" {
                    if let Ok(address) = token[1].parse::<Ipv4Addr>() {
                        if is_private_ipv4(address) && !addresses.contains(&address) {
                            addresses.push(address);
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = StdCommand::new("ipconfig").output() {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if let Some(pos) = line.find(':') {
                    let after_colon = line[pos + 1..].trim();
                    if let Ok(address) = after_colon.parse::<Ipv4Addr>() {
                        if is_private_ipv4(address) && !addresses.contains(&address) {
                            addresses.push(address);
                        }
                    }
                }
            }
        }
    }

    if addresses.is_empty() {
        if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
            let _ = socket.connect("8.8.8.8:80");
            if let Ok(SocketAddr::V4(addr)) = socket.local_addr() {
                let ip = *addr.ip();
                if is_private_ipv4(ip) {
                    addresses.push(ip);
                }
            }
        }
    }

    addresses.sort_by_key(|address| {
        let parts = address.octets();
        (!(parts[0] == 192 && parts[1] == 168), parts)
    });
    addresses
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn http_decode(value: &str) -> String {
    urlencoding::decode(value)
        .map(|value| value.to_string())
        .unwrap_or_default()
}

fn http_response(status: &str, content_type: &str, body: Vec<u8>) -> Vec<u8> {
    let mut response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    response.extend(body);
    response
}

fn request_header(request: &str, name: &str) -> Option<String> {
    request.lines().skip(1).find_map(|line| {
        let (header, value) = line.split_once(':')?;
        header
            .eq_ignore_ascii_case(name)
            .then(|| value.trim().to_string())
    })
}

fn stream_file(mut stream: TcpStream, path: &Path, content_type: &str, range: Option<&str>) {
    let metadata = match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => metadata,
        _ => {
            let _ = stream.write_all(&http_response(
                "404 Not Found",
                "text/plain; charset=utf-8",
                b"Not found".to_vec(),
            ));
            return;
        }
    };
    let total_size = metadata.len();

    if let Some((start, end)) = parse_range_header(range, total_size) {
        if let Err(_) = stream_file_range(&mut stream, path, content_type, start, end, total_size) {
            let _ = stream.write_all(&http_response(
                "500 Internal Server Error",
                "text/plain; charset=utf-8",
                b"Read failed".to_vec(),
            ));
        }
        return;
    }

    match fs::read(path) {
        Ok(body) => {
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(&body);
        }
        Err(_) => {
            let _ = stream.write_all(&http_response(
                "404 Not Found",
                "text/plain; charset=utf-8",
                b"Not found".to_vec(),
            ));
        }
    }
}

fn parse_range_header(range: Option<&str>, total_size: u64) -> Option<(u64, u64)> {
    if total_size == 0 {
        return None;
    }

    let range = range?.trim().strip_prefix("bytes=")?;
    let (start, end) = range.split_once('-')?;

    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?.min(total_size);
        return Some((total_size - suffix, total_size - 1));
    }

    let start = start.parse::<u64>().ok()?;
    if start >= total_size {
        return None;
    }

    let end = if end.is_empty() {
        total_size - 1
    } else {
        end.parse::<u64>().ok()?.min(total_size - 1)
    };

    (start <= end).then_some((start, end))
}

fn stream_file_range(
    stream: &mut TcpStream,
    path: &Path,
    content_type: &str,
    start: u64,
    end: u64,
    total_size: u64,
) -> io::Result<()> {
    let mut file = fs::File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let length = end - start + 1;
    let header = format!(
        "HTTP/1.1 206 Partial Content\r\nContent-Type: {content_type}\r\nContent-Length: {length}\r\nContent-Range: bytes {start}-{end}/{total_size}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(header.as_bytes())?;
    io::copy(&mut file.take(length), stream)?;
    Ok(())
}

fn shared_styles() -> &'static str {
    r#"
:root{--bg:#f4f2ee;--panel:#fff;--panel-soft:#faf9f6;--text:#252423;--muted:#6f6a64;--line:#ddd8cf;--accent:#1264a3;--accent-soft:#e4f0f8;--shadow:0 16px 40px rgba(42,37,31,.12)}
*{box-sizing:border-box}html,body{width:100%;height:100%}body{margin:0;overflow:hidden;color:var(--text);background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:0}
a{color:inherit;text-decoration:none}button{font:inherit}.app-shell{display:grid;grid-template-rows:58px minmax(0,1fr);height:100%}.toolbar{display:grid;grid-template-columns:auto minmax(180px,1fr) auto;align-items:center;gap:14px;padding:10px 16px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.9);backdrop-filter:blur(18px)}
.window-dots{display:flex;gap:7px}.dot{width:12px;height:12px;border-radius:50%;display:block}.red{background:#ff6257}.yellow{background:#ffbd2e}.green{background:#28c840}.brand{min-width:0}.brand strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.brand span{display:block;margin-top:2px;color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.toolbar-actions{display:flex;align-items:center;gap:8px}.pill{height:34px;display:inline-flex;align-items:center;padding:0 11px;border:1px solid #9bc5e0;border-radius:8px;color:var(--accent);background:var(--accent-soft);font-size:13px;font-weight:650}
.workspace{min-height:0;display:grid;grid-template-columns:minmax(360px,1fr) minmax(310px,380px)}.browser-panel,.preview-panel{min-height:0;background:var(--panel)}
.browser-panel{display:grid;grid-template-rows:auto minmax(0,1fr);background:var(--panel-soft)}.browser-header{padding:18px 24px 12px;border-bottom:1px solid var(--line)}.breadcrumbs{display:flex;align-items:center;gap:6px;min-width:0;white-space:nowrap;overflow:hidden}.crumb{max-width:180px;overflow:hidden;text-overflow:ellipsis;color:var(--muted);border-radius:6px;padding:4px 6px}.crumb:hover,.crumb.active{color:var(--text);background:#ece7df}.crumb-separator{color:#a39b90}.browser-header h1{margin:10px 0 0;font-size:24px;line-height:1.18}.browser-header p{margin:4px 0 0;color:var(--muted);font-size:13px}.content-area{min-height:0;padding:18px 20px 24px;overflow:auto}
.module-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}.module-card{min-width:0;display:grid;grid-template-columns:42px minmax(0,1fr);gap:12px;align-items:center;padding:14px;border:1px solid var(--line);border-radius:8px;background:var(--panel);box-shadow:0 6px 16px rgba(42,37,31,.06)}.module-card:hover{border-color:#9bc5e0;box-shadow:var(--shadow)}.shared-icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}.shared-icon svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}.shared-folder-icon svg{width:36px;height:36px;fill:#d8ad42;stroke:#9a6b12;stroke-width:1.4}.shared-file-icon{width:26px;height:26px;color:var(--accent);border:1px solid #9bc5e0;border-radius:6px;background:#f8fbfd}.shared-file-icon svg{width:16px;height:16px}.shared-image-icon{color:#0b78b6}.module-card-title,.file-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}.item-subtitle{display:block;margin-top:4px;color:var(--muted);font-size:13px}
.file-table{min-width:680px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--panel)}.file-row,.file-head{display:grid;grid-template-columns:minmax(220px,1fr) 150px 96px 92px;align-items:center;gap:12px;padding:0 14px;border-bottom:1px solid var(--line)}.file-head{height:36px;color:var(--muted);font-size:12px;font-weight:700;background:#f0ece5}.file-row{height:46px}.file-row:last-child{border-bottom:0}.file-row:hover,.file-row.selected{background:var(--accent-soft);color:var(--accent)}.file-primary{min-width:0;display:grid;grid-template-columns:38px minmax(0,1fr);align-items:center;gap:10px}.file-cell{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:13px}.preview-panel{display:grid;grid-template-rows:auto minmax(0,1fr);border-left:1px solid var(--line)}.preview-toolbar{padding:18px;border-bottom:1px solid var(--line)}.preview-toolbar h2{max-width:260px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:18px}.preview-toolbar p{margin:4px 0 0;color:var(--muted);font-size:13px}.preview-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.type-tag{display:inline-flex;align-items:center;min-height:24px;padding:0 8px;border:1px solid var(--line);border-radius:999px;background:#f7f5f0;color:var(--muted);font-size:12px}.preview-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.preview-action{height:30px;display:inline-flex;align-items:center;justify-content:center;padding:0 10px;border:1px solid #9bc5e0;border-radius:8px;color:var(--accent);background:var(--accent-soft);font-size:13px;font-weight:650;cursor:pointer}.preview-action.disabled{cursor:default;opacity:.45;color:var(--muted);border-color:var(--line);background:#f7f5f0}.preview-body{min-height:0;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;background:#f7f5f0}.preview-empty,.unsupported-preview{width:100%;min-height:220px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--muted);text-align:center}.empty-icon .shared-icon{transform:scale(1.35);margin-bottom:8px}.preview-empty strong,.unsupported-preview strong{font-size:14px;font-weight:650}.preview-body img{max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;background:#fff;box-shadow:0 12px 32px rgba(42,37,31,.12);cursor:zoom-in}.preview-body video,.preview-body iframe{width:100%;min-height:420px;border:1px solid var(--line);border-radius:8px;background:#fff}.preview-body audio{width:100%}.music-preview{width:min(100%,460px);min-height:220px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:18px;color:var(--muted);text-align:center}.music-preview .shared-icon{width:42px;height:42px}.music-preview .shared-icon svg{width:26px;height:26px}.music-preview strong{color:var(--text);font-size:15px}.music-preview video,.music-preview audio{width:100%;min-height:auto}.music-preview video{min-height:260px}.preview-body pre{width:100%;height:100%;margin:0;padding:14px;overflow:auto;color:#222;border:1px solid var(--line);border-radius:8px;background:#fff;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}.lightbox-open{overflow:hidden}.image-lightbox{position:fixed;inset:0;z-index:9999;display:none;grid-template-rows:64px minmax(0,1fr);color:#f6f3ed;background:rgba(17,18,20,.96);overscroll-behavior:none;touch-action:none}.lightbox-open .image-lightbox{display:grid}.lightbox-topbar{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.14)}.lightbox-topbar strong{display:block;max-width:min(720px,58vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px}.lightbox-topbar span{display:block;margin-top:4px;color:rgba(246,243,237,.68);font-size:13px}.lightbox-actions{display:flex;gap:8px}.lightbox-actions button{height:34px;padding:0 12px;border:1px solid rgba(255,255,255,.2);border-radius:8px;color:#f6f3ed;background:rgba(255,255,255,.08);cursor:pointer}.lightbox-actions button:disabled{cursor:default;opacity:.38}.lightbox-body{min-height:0;display:flex;align-items:center;justify-content:center;padding:18px;overflow:hidden}.lightbox-body img{max-width:100%;max-height:100%;object-fit:contain}
.music-preview{width:min(100%,520px);align-items:stretch}.music-preview .empty-icon,.music-preview strong{align-self:center}.music-preview .aplayer-host,.music-preview .aplayer{width:100%}.music-preview .aplayer{margin:0;border:1px solid var(--line);border-radius:8px;box-shadow:0 12px 30px rgba(42,37,31,.1);text-align:left}.music-preview .aplayer-fallback[hidden]{display:none}
@media(max-width:1100px){body{overflow:auto}.app-shell{height:auto;min-height:100%}.workspace{display:block}.preview-panel{display:none}.has-preview .preview-panel{display:grid;min-height:520px;border-left:0;border-top:1px solid var(--line)}.content-area{overflow:visible}.toolbar{grid-template-columns:minmax(0,1fr) auto}.window-dots{display:none}.file-table{min-width:560px}}@media(max-width:760px){.toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.toolbar-actions{margin-left:auto}.pill{max-width:100%;overflow:hidden}.browser-header{padding:14px}.content-area{padding:12px}.module-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}.has-preview .preview-panel{min-height:460px}.preview-body video,.preview-body iframe{min-height:300px}}
"#
}

fn parent_rel_path(path: &str) -> String {
    let mut parts = path
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    parts.pop();
    parts.join("/")
}

fn entry_type_label(entry: &FileEntry) -> &'static str {
    if entry.entry_type == "directory" {
        "文件夹"
    } else {
        match entry.kind.as_str() {
            "image" => "图片",
            "text" => "文本",
            "pdf" => "PDF",
            "music" => "音乐",
            "audio" => "音频",
            "video" => "视频",
            _ => "文件",
        }
    }
}

fn shared_icon(kind: &str) -> &'static str {
    match kind {
        "directory" => {
            r#"<span class="shared-icon shared-folder-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"></path></svg></span>"#
        }
        "image" => {
            r#"<span class="shared-icon shared-file-icon shared-image-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="m21 15-5-5L5 21"></path></svg></span>"#
        }
        "music" | "audio" => {
            r#"<span class="shared-icon shared-file-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg></span>"#
        }
        "video" => {
            r#"<span class="shared-icon shared-file-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="14" height="14" rx="2"></rect><path d="m17 9 4-2v10l-4-2z"></path></svg></span>"#
        }
        "pdf" => {
            r#"<span class="shared-icon shared-file-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M7.5 16h9"></path><path d="M8 12h8"></path></svg></span>"#
        }
        "text" => {
            r#"<span class="shared-icon shared-file-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h6"></path></svg></span>"#
        }
        _ => {
            r#"<span class="shared-icon shared-file-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg></span>"#
        }
    }
}

fn shared_entry_icon(entry: &FileEntry) -> &'static str {
    if entry.entry_type == "directory" {
        shared_icon("directory")
    } else {
        shared_icon(&entry.kind)
    }
}

fn shared_empty_state(message: &str, icon_kind: &str) -> String {
    format!(
        r#"<div class="preview-empty"><span class="empty-icon">{}</span><strong>{}</strong></div>"#,
        shared_icon(icon_kind),
        html_escape(message)
    )
}

fn shared_base_script() -> &'static str {
    r#"<script>
document.querySelectorAll('[data-time]').forEach((element) => {
  const seconds = Number(element.dataset.time);
  if (!seconds) return;
  element.textContent = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(seconds * 1000));
});
document.querySelectorAll('[data-aplayer]').forEach((container) => {
  if (!window.APlayer) return;
  const fallback = container.parentElement?.querySelector('.aplayer-fallback');
  let audio = [];
  try {
    audio = JSON.parse(container.dataset.playlist || '[]');
  } catch (error) {
    audio = [];
  }
  if (!audio.length && container.dataset.url) {
    audio = [{
      name: container.dataset.title || '音乐',
      artist: 'oFinder',
      url: container.dataset.url
    }];
  }
  try {
    const player = new APlayer({
      container,
      mutex: true,
      preload: 'metadata',
      listMaxHeight: '180px',
      listmaxheight: '180px',
      theme: '#1264a3',
      audio
    });
    const index = Number(container.dataset.currentIndex || 0);
    if (index > 0) player.switchAudio(index);
    if (fallback) fallback.hidden = true;
  } catch (error) {
    if (fallback) fallback.hidden = false;
  }
});
</script>"#
}

fn kind_label_from_mime(path: &Path, mime: &str) -> &'static str {
    if mime.starts_with("image/") {
        "图片"
    } else if is_music_extension(path) {
        "音乐"
    } else if mime.starts_with("video/") {
        "视频"
    } else if mime.starts_with("audio/") {
        "音频"
    } else if mime == "application/pdf" {
        "PDF"
    } else if mime.starts_with("text/") || is_text_extension(path) {
        "文本"
    } else {
        "文件"
    }
}

fn format_size(size: Option<u64>) -> String {
    let Some(size) = size else {
        return "--".into();
    };
    if size < 1024 {
        return format!("{size} B");
    }
    let units = ["KB", "MB", "GB", "TB"];
    let mut value = size as f64 / 1024.0;
    let mut index = 0;
    while value >= 1024.0 && index < units.len() - 1 {
        value /= 1024.0;
        index += 1;
    }
    if value >= 10.0 {
        format!("{value:.0} {}", units[index])
    } else {
        format!("{value:.1} {}", units[index])
    }
}

fn render_breadcrumbs(crumbs: &[Breadcrumb]) -> String {
    let mut html = String::from(r#"<nav class="breadcrumbs" aria-label="路径">"#);
    for (index, crumb) in crumbs.iter().enumerate() {
        if index > 0 {
            html.push_str(r#"<span class="crumb-separator">/</span>"#);
        }
        let encoded = urlencoding::encode(&crumb.path);
        let active = if index == crumbs.len() - 1 {
            " active"
        } else {
            ""
        };
        html.push_str(&format!(
            r#"<a class="crumb{active}" href="/?path={encoded}">{}</a>"#,
            html_escape(&crumb.name)
        ));
    }
    html.push_str("</nav>");
    html
}

fn render_file_rows(entries: &[FileEntry], selected: Option<&str>) -> String {
    let mut html = String::from(
        r#"<div class="file-table"><div class="file-head"><span>名称</span><span>修改时间</span><span>大小</span><span>类型</span></div>"#,
    );
    for entry in entries {
        let encoded = urlencoding::encode(&entry.path);
        let href = if entry.entry_type == "directory" {
            format!("/?path={encoded}")
        } else {
            format!("/preview?path={encoded}")
        };
        let selected_class = if selected == Some(entry.path.as_str()) {
            " selected"
        } else {
            ""
        };
        let size = if entry.entry_type == "directory" {
            format!("{} 项", entry.children.unwrap_or(0))
        } else {
            format_size(entry.size)
        };
        html.push_str(&format!(
            r#"<a class="file-row{selected_class}" href="{href}"><span class="file-primary">{}<span class="file-name">{}</span></span><span class="file-cell" data-time="{}">{}</span><span class="file-cell">{}</span><span class="file-cell">{}</span></a>"#,
            shared_entry_icon(entry),
            html_escape(&entry.name),
            entry.modified_at,
            entry.modified_at,
            html_escape(&size),
            entry_type_label(entry)
        ));
    }
    html.push_str("</div>");
    html
}

fn render_preview_tags(tags: &[String]) -> String {
    if tags.is_empty() {
        return String::new();
    }

    let tags_html = tags
        .iter()
        .map(|tag| format!(r#"<span class="type-tag">{}</span>"#, html_escape(tag)))
        .collect::<Vec<_>>()
        .join("");
    format!(r#"<div class="preview-tags">{tags_html}</div>"#)
}

fn image_preview_items(entries: &[FileEntry]) -> Vec<ImagePreviewItem> {
    entries
        .iter()
        .filter(|entry| entry.entry_type == "file" && entry.kind == "image")
        .map(|entry| {
            let encoded = urlencoding::encode(&entry.path).to_string();
            ImagePreviewItem {
                path: entry.path.clone(),
                name: entry.name.clone(),
                preview_url: format!("/thumb?path={encoded}&size=2200"),
                full_url: format!("/file?path={encoded}"),
                page_url: format!("/preview?path={encoded}"),
            }
        })
        .collect()
}

fn is_music_player_entry(entry: &FileEntry) -> bool {
    entry.entry_type == "file" && (entry.kind == "music" || entry.kind == "audio")
}

fn music_preview_items(entries: &[FileEntry]) -> Vec<MusicPreviewItem> {
    entries
        .iter()
        .filter(|entry| is_music_player_entry(entry))
        .map(|entry| {
            let encoded = urlencoding::encode(&entry.path).to_string();
            MusicPreviewItem {
                path: entry.path.clone(),
                name: entry.name.clone(),
                artist: "oFinder".into(),
                url: format!("/file?path={encoded}"),
            }
        })
        .collect()
}

fn render_image_preview_actions(
    entries: &[FileEntry],
    selected_path: Option<&str>,
    mime: Option<&str>,
) -> String {
    if !mime.is_some_and(|mime| mime.starts_with("image/")) {
        return String::new();
    }

    let images = image_preview_items(entries);
    let Some(index) =
        selected_path.and_then(|path| images.iter().position(|image| image.path == path))
    else {
        return String::new();
    };

    let prev = if index > 0 {
        format!(
            r#"<a class="preview-action" href="{}" title="上一张">上一张</a>"#,
            images[index - 1].page_url
        )
    } else {
        r#"<span class="preview-action disabled">上一张</span>"#.into()
    };
    let next = if index + 1 < images.len() {
        format!(
            r#"<a class="preview-action" href="{}" title="下一张">下一张</a>"#,
            images[index + 1].page_url
        )
    } else {
        r#"<span class="preview-action disabled">下一张</span>"#.into()
    };

    format!(
        r#"<div class="preview-actions">{prev}{next}<button class="preview-action" type="button" data-fullscreen-trigger>全屏</button></div>"#
    )
}

fn render_share_script(
    entries: &[FileEntry],
    selected_path: Option<&str>,
    mime: Option<&str>,
) -> String {
    if !mime.is_some_and(|mime| mime.starts_with("image/")) {
        return String::new();
    }

    let images = image_preview_items(entries);
    if images.is_empty() {
        return String::new();
    }

    let selected_path = selected_path.unwrap_or_default();
    let Ok(images_json) = serde_json::to_string(&images) else {
        return String::new();
    };
    let selected_json = serde_json::to_string(selected_path).unwrap_or_else(|_| r#""""#.into());

    format!(
        r#"<script>
(() => {{
  const images = {images_json};
  let current = Math.max(0, images.findIndex((item) => item.path === {selected_json}));
  const overlay = document.createElement('div');
  overlay.className = 'image-lightbox';
  overlay.innerHTML = '<div class="lightbox-topbar"><div><strong id="lightboxTitle"></strong><span id="lightboxMeta"></span></div><div class="lightbox-actions"><button type="button" data-action="prev">上一张</button><button type="button" data-action="next">下一张</button><button type="button" data-action="close">关闭</button></div></div><div class="lightbox-body"><img id="lightboxImage" alt=""></div>';
  document.body.appendChild(overlay);
  const image = overlay.querySelector('#lightboxImage');
  const title = overlay.querySelector('#lightboxTitle');
  const meta = overlay.querySelector('#lightboxMeta');
  const buttons = overlay.querySelectorAll('[data-action]');
  const mobileQuery = window.matchMedia('(max-width: 760px)');
  let touchStartY = 0;

  function sync() {{
    const item = images[current];
    if (!item) return;
    image.src = item.previewUrl;
    image.alt = item.name;
    title.textContent = item.name;
    meta.textContent = `${{current + 1}} / ${{images.length}}`;
    buttons.forEach((button) => {{
      const action = button.dataset.action;
      button.disabled = (action === 'prev' && current <= 0) || (action === 'next' && current >= images.length - 1);
    }});
  }}
  function open() {{
    sync();
    document.body.classList.add('lightbox-open');
  }}
  function close() {{
    document.body.classList.remove('lightbox-open');
  }}
  function move(delta) {{
    const next = Math.min(Math.max(current + delta, 0), images.length - 1);
    if (next === current) return;
    current = next;
    sync();
  }}
  document.querySelector('[data-fullscreen-trigger]')?.addEventListener('click', open);
  document.querySelector('.preview-body img')?.addEventListener('click', open);
  if (mobileQuery.matches) {{
    window.requestAnimationFrame(open);
  }}
  overlay.addEventListener('click', (event) => {{
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'prev') move(-1);
    if (action === 'next') move(1);
    if (action === 'close') close();
  }});
  overlay.addEventListener('touchstart', (event) => {{
    touchStartY = event.touches[0]?.clientY || 0;
  }}, {{ passive: true }});
  overlay.addEventListener('touchend', (event) => {{
    const endY = event.changedTouches[0]?.clientY || 0;
    const deltaY = endY - touchStartY;
    if (Math.abs(deltaY) < 48) return;
    event.preventDefault();
    move(deltaY < 0 ? 1 : -1);
  }}, {{ passive: false }});
  overlay.addEventListener('touchmove', (event) => {{
    event.preventDefault();
  }}, {{ passive: false }});
  document.addEventListener('keydown', (event) => {{
    if (!document.body.classList.contains('lightbox-open')) return;
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(-1);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(1);
  }});
}})();
</script>"#
    )
}

fn render_share_audio_script(
    entries: &[FileEntry],
    selected_path: Option<&str>,
    mime: Option<&str>,
) -> String {
    let is_audio = mime.is_some_and(|mime| {
        mime.starts_with("audio/")
            || entries
                .iter()
                .any(|e| e.path == selected_path.unwrap_or("") && is_music_player_entry(e))
    });
    if !is_audio {
        return String::new();
    }

    let playlist = music_preview_items(entries);
    let current_index = selected_path
        .and_then(|path| playlist.iter().position(|item| item.path == path))
        .unwrap_or(0);
    let Ok(playlist_json) = serde_json::to_string(&playlist) else {
        return String::new();
    };
    let selected_name = selected_path
        .and_then(|path| {
            entries
                .iter()
                .find(|e| e.path == path)
                .map(|e| e.name.clone())
        })
        .unwrap_or_default();

    format!(
        r#"<script>
(() => {{
  const mobileQuery = window.matchMedia('(max-width: 760px)');
  if (!mobileQuery.matches) return;
  const playlist = {playlist_json};
  if (!playlist.length) return;
  const currentIndex = {current_index};
  const overlay = document.createElement('div');
  overlay.className = 'image-lightbox';
  overlay.innerHTML = '<div class="lightbox-topbar"><div><strong id="lightboxAudioTitle">{selected_name}</strong></div><div class="lightbox-actions"><button type="button" data-action="close">关闭</button></div></div><div class="lightbox-body" style="align-items:stretch;padding:12px"><div class="music-preview" style="width:100%;min-height:0;gap:0"><div class="aplayer-host"></div><audio class="aplayer-fallback" controls preload="metadata"></audio></div></div>';
  document.body.appendChild(overlay);
  const host = overlay.querySelector('.aplayer-host');
  const fallback = overlay.querySelector('.aplayer-fallback');
  if (playlist[currentIndex]) {{
    fallback.src = playlist[currentIndex].url;
  }}
  document.body.classList.add('lightbox-open');
  try {{
    new APlayer({{
      container: host,
      mutex: true,
      preload: 'metadata',
      listMaxHeight: '180px',
      listmaxheight: '180px',
      theme: '#1264a3',
      audio: playlist,
      index: currentIndex
    }});
    fallback.hidden = true;
  }} catch (error) {{
    fallback.hidden = false;
  }}
  overlay.addEventListener('click', (event) => {{
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'close') {{
      document.body.classList.remove('lightbox-open');
      overlay.remove();
    }}
  }});
  document.addEventListener('keydown', (event) => {{
    if (!document.body.classList.contains('lightbox-open')) return;
    if (event.key === 'Escape') {{
      document.body.classList.remove('lightbox-open');
      overlay.remove();
    }}
  }});
}})();
</script>"#
    )
}

fn render_share_shell(
    listing: &DirectoryListing,
    content: &str,
    preview_title: &str,
    preview_meta: &str,
    preview_tags: &str,
    preview_actions: &str,
    preview_body: &str,
    script: &str,
) -> Vec<u8> {
    let body_class = if preview_tags.is_empty() {
        ""
    } else {
        r#" class="has-preview""#
    };
    let body = SHARE_SHELL_TEMPLATE
        .replace("{{styles}}", shared_styles())
        .replace("{{body_class}}", body_class)
        .replace("{{root}}", &html_escape(&listing.root))
        .replace("{{breadcrumbs}}", &render_breadcrumbs(&listing.breadcrumbs))
        .replace("{{title}}", &html_escape(&listing.name))
        .replace("{{count}}", &listing.entries.len().to_string())
        .replace("{{content}}", content)
        .replace("{{preview_title}}", &html_escape(preview_title))
        .replace("{{preview_meta}}", &html_escape(preview_meta))
        .replace("{{preview_tags}}", preview_tags)
        .replace("{{preview_actions}}", preview_actions)
        .replace("{{preview_body}}", preview_body)
        .replace("{{script}}", &format!("{}{}", shared_base_script(), script));
    http_response("200 OK", "text/html; charset=utf-8", body.into_bytes())
}

fn shared_page(root: &Path, path: Option<String>) -> Vec<u8> {
    let listing = match list_directory_inner(root, path) {
        Ok(listing) => listing,
        Err(error) => {
            return http_response(
                "400 Bad Request",
                "text/plain; charset=utf-8",
                error.into_bytes(),
            )
        }
    };

    let content = if listing.entries.is_empty() {
        shared_empty_state("没有可显示的文件", "directory")
    } else {
        render_file_rows(&listing.entries, None)
    };

    render_share_shell(
        &listing,
        &content,
        "预览",
        "",
        "",
        "",
        &shared_empty_state("选择文件", "image"),
        "",
    )
}

fn render_preview_body(
    full_path: &Path,
    rel_path: &str,
    mime: &str,
    entries: &[FileEntry],
) -> String {
    let encoded = urlencoding::encode(rel_path);
    if mime.starts_with("image/") {
        format!(r#"<img src="/thumb?path={encoded}&size=1800" alt="">"#)
    } else if is_music_extension(full_path) || mime.starts_with("audio/") {
        let source = format!("/file?path={encoded}");
        let title = full_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("音乐");
        let mut playlist = music_preview_items(entries);
        if !playlist.iter().any(|item| item.path == rel_path) {
            playlist.insert(
                0,
                MusicPreviewItem {
                    path: rel_path.into(),
                    name: title.into(),
                    artist: "oFinder".into(),
                    url: source.clone(),
                },
            );
        }
        let current_index = playlist
            .iter()
            .position(|item| item.path == rel_path)
            .unwrap_or(0);
        let playlist_json = serde_json::to_string(&playlist).unwrap_or_else(|_| "[]".into());
        format!(
            r#"<div class="music-preview"><span class="empty-icon">{}</span><strong>音乐预览</strong><div class="aplayer-host" data-aplayer data-current-index="{}" data-title="{}" data-url="{}" data-playlist="{}"></div><audio class="aplayer-fallback" src="{}" controls preload="metadata"></audio></div>"#,
            shared_icon("music"),
            current_index,
            html_escape(title),
            html_escape(&source),
            html_escape(&playlist_json),
            html_escape(&source)
        )
    } else if mime.starts_with("video/") {
        format!(r#"<video src="/file?path={encoded}" controls preload="metadata"></video>"#)
    } else if mime == "application/pdf" {
        format!(r#"<iframe src="/file?path={encoded}"></iframe>"#)
    } else if mime.starts_with("text/") || is_text_extension(full_path) {
        match fs::metadata(full_path) {
            Ok(metadata) if metadata.len() <= 2 * 1024 * 1024 => {
                let text = fs::read_to_string(full_path).unwrap_or_else(|_| "无法读取文本".into());
                format!("<pre>{}</pre>", html_escape(&text))
            }
            _ => shared_empty_state("文本文件过大", "text"),
        }
    } else {
        format!(
            r#"<div class="unsupported-preview"><span class="empty-icon">{}</span><strong>无法直接预览</strong><a class="pill" href="/file?path={encoded}">下载/打开原文件</a></div>"#,
            shared_icon("file")
        )
    }
}

fn shared_preview(root: &Path, rel_path: String) -> Vec<u8> {
    let (_, full_path) = match resolve_path(root, Some(rel_path.clone())) {
        Ok(value) => value,
        Err(error) => {
            return http_response(
                "400 Bad Request",
                "text/plain; charset=utf-8",
                error.into_bytes(),
            )
        }
    };
    let mime = mime_guess::from_path(&full_path)
        .first_or_octet_stream()
        .to_string();
    let parent = parent_rel_path(&rel_path);
    let listing = match list_directory_inner(
        root,
        if parent.is_empty() {
            None
        } else {
            Some(parent)
        },
    ) {
        Ok(listing) => listing,
        Err(error) => {
            return http_response(
                "400 Bad Request",
                "text/plain; charset=utf-8",
                error.into_bytes(),
            )
        }
    };
    let preview_name = full_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("预览");
    let content = render_file_rows(&listing.entries, Some(&rel_path));
    let preview_body = render_preview_body(&full_path, &rel_path, &mime, &listing.entries);
    let size = fs::metadata(&full_path).ok().map(|metadata| metadata.len());
    let preview_tags = render_preview_tags(&[
        kind_label_from_mime(&full_path, &mime).to_string(),
        mime.clone(),
        format_size(size),
    ]);
    let preview_actions =
        render_image_preview_actions(&listing.entries, Some(&rel_path), Some(&mime));
    let script = format!(
        "{}{}",
        render_share_script(&listing.entries, Some(&rel_path), Some(&mime)),
        render_share_audio_script(&listing.entries, Some(&rel_path), Some(&mime))
    );
    render_share_shell(
        &listing,
        &content,
        preview_name,
        "类型检测结果",
        &preview_tags,
        &preview_actions,
        &preview_body,
        &script,
    )
}

fn handle_share_connection(mut stream: TcpStream, root: Arc<Mutex<PathBuf>>) {
    let mut buffer = [0_u8; 8192];
    let size = match stream.read(&mut buffer) {
        Ok(size) => size,
        Err(_) => return,
    };
    let request = String::from_utf8_lossy(&buffer[..size]);
    let line = request.lines().next().unwrap_or("");
    let target = line.split_whitespace().nth(1).unwrap_or("/");
    let (route, query) = target.split_once('?').unwrap_or((target, ""));
    let rel_path = query
        .split('&')
        .find_map(|part| part.strip_prefix("path="))
        .map(http_decode);
    let range = request_header(&request, "Range");
    let root_path = root
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_else(|_| default_root());

    match route {
        "/assets/aplayer.css" => {
            let _ = stream.write_all(&http_response(
                "200 OK",
                "text/css; charset=utf-8",
                APLAYER_CSS.to_vec(),
            ));
        }
        "/assets/aplayer.js" => {
            let _ = stream.write_all(&http_response(
                "200 OK",
                "application/javascript; charset=utf-8",
                APLAYER_JS.to_vec(),
            ));
        }
        "/" => {
            let response = shared_page(&root_path, rel_path);
            let _ = stream.write_all(&response);
        }
        "/preview" => {
            let response = rel_path
                .map(|path| shared_preview(&root_path, path))
                .unwrap_or_else(|| {
                    http_response(
                        "400 Bad Request",
                        "text/plain; charset=utf-8",
                        b"Missing path".to_vec(),
                    )
                });
            let _ = stream.write_all(&response);
        }
        "/thumb" => {
            let size = query
                .split('&')
                .find_map(|part| part.strip_prefix("size="))
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or(420)
                .clamp(160, 2400);
            if let Some(path) = rel_path {
                if let Ok((_, full_path)) = resolve_path(&root_path, Some(path)) {
                    let mime = mime_guess::from_path(&full_path)
                        .first_or_octet_stream()
                        .to_string();
                    let (file, content_type) = if is_resizable_image(&full_path, &mime) {
                        match ensure_preview(&full_path, size) {
                            Ok(cache_path) => (cache_path, "image/jpeg".to_string()),
                            Err(_) => (full_path, mime),
                        }
                    } else {
                        (full_path, mime)
                    };
                    stream_file(stream, &file, &content_type, range.as_deref());
                    return;
                }
            }
            let _ = stream.write_all(&http_response(
                "404 Not Found",
                "text/plain; charset=utf-8",
                b"Not found".to_vec(),
            ));
        }
        "/file" => {
            if let Some(path) = rel_path {
                if let Ok((_, full_path)) = resolve_path(&root_path, Some(path)) {
                    let mime = mime_guess::from_path(&full_path)
                        .first_or_octet_stream()
                        .to_string();
                    stream_file(stream, &full_path, &mime, range.as_deref());
                    return;
                }
            }
            let _ = stream.write_all(&http_response(
                "404 Not Found",
                "text/plain; charset=utf-8",
                b"Not found".to_vec(),
            ));
        }
        _ => {
            let _ = stream.write_all(&http_response(
                "404 Not Found",
                "text/plain; charset=utf-8",
                b"Not found".to_vec(),
            ));
        }
    }
}

fn ensure_share_server(state: &AppState, preferred_port: Option<u16>) -> Result<u16, String> {
    if let Some(port) = *state.share_port.lock().map_err(|error| error.to_string())? {
        if preferred_port.is_some_and(|preferred| preferred != port) {
            return Err(format!(
                "当前分享服务已运行在端口 {port}，切换锁定端口需要重启应用。"
            ));
        }
        return Ok(port);
    }

    let bind_port = preferred_port.unwrap_or(0);
    let listener = TcpListener::bind(("0.0.0.0", bind_port))
        .map_err(|error| format!("端口 {bind_port} 无法使用：{error}"))?;
    listener
        .set_nonblocking(false)
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let root = state.share_root.clone();

    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let root = root.clone();
            thread::spawn(move || handle_share_connection(stream, root));
        }
    });

    *state.share_port.lock().map_err(|error| error.to_string())? = Some(port);
    Ok(port)
}

fn preview_cache_path(path: &Path, size: u32) -> Result<PathBuf, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let modified = modified_seconds(&metadata);
    let mut hasher = Sha1::new();
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(format!(":{}:{}:{}", modified, metadata.len(), size).as_bytes());
    let key = format!("{:x}", hasher.finalize());
    let cache_dir = dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("oFinder")
        .join("previews");
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    Ok(cache_dir.join(format!("{key}-{size}.jpg")))
}

fn ensure_preview(path: &Path, size: u32) -> Result<PathBuf, String> {
    let cache_path = preview_cache_path(path, size)?;
    if cache_path.exists()
        && fs::metadata(&cache_path)
            .map(|meta| meta.len() > 0)
            .unwrap_or(false)
    {
        return Ok(cache_path);
    }

    let temp_path = cache_path.with_extension(format!("{}.tmp.jpg", std::process::id()));
    let img = image::open(path).map_err(|e| format!("Image open failed: {e}"))?;
    let resized = img.thumbnail(size, size);
    resized
        .save(&temp_path)
        .map_err(|e| format!("Image save failed: {e}"))?;

    fs::rename(&temp_path, &cache_path).map_err(|error| error.to_string())?;
    Ok(cache_path)
}

#[tauri::command]
fn list_modules(
    root: Option<String>,
    state: State<'_, AppState>,
) -> Result<ModulesListing, String> {
    let root = resolve_root(root, &state);
    if let Ok(mut share_root) = state.share_root.lock() {
        *share_root = root.clone();
    }
    let modules = list_root_modules_inner(&root)?;
    let total = modules.len();

    Ok(ModulesListing {
        root: root.to_string_lossy().to_string(),
        modules,
        total,
    })
}

#[tauri::command]
fn list_directory(
    root: Option<String>,
    path: Option<String>,
    state: State<'_, AppState>,
) -> Result<DirectoryListing, String> {
    let root = resolve_root(root, &state);
    if let Ok(mut share_root) = state.share_root.lock() {
        *share_root = root.clone();
    }
    list_directory_inner(&root, path)
}

#[tauri::command]
fn share_info(
    root: Option<String>,
    locked_port: Option<u16>,
    state: State<'_, AppState>,
) -> Result<ShareInfo, String> {
    let root = resolve_root(root, &state);
    if let Ok(mut share_root) = state.share_root.lock() {
        *share_root = root.clone();
    }
    let port = ensure_share_server(&state, locked_port)?;
    let mut config = read_app_config();
    config.share_port = Some(port);
    config.share_port_locked = locked_port.is_some();
    write_app_config(&config)?;
    let lan_urls = lan_addresses()
        .into_iter()
        .map(|address| format!("http://{address}:{port}"))
        .collect();

    Ok(ShareInfo {
        root: root.to_string_lossy().to_string(),
        port,
        local_url: format!("http://127.0.0.1:{port}"),
        lan_urls,
    })
}

#[tauri::command]
fn file_url(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err("File not found.".into());
    }

    Ok(asset_url(&path))
}

#[tauri::command]
fn preview_url(path: String, size: Option<u32>) -> Result<String, String> {
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err("File not found.".into());
    }

    let size = size.unwrap_or(1200).clamp(160, 2400);
    let mime = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();
    if !is_resizable_image(&path, &mime) {
        return Ok(asset_url(&path));
    }

    match ensure_preview(&path, size) {
        Ok(cache_path) => Ok(asset_url(&cache_path)),
        Err(_) => Ok(asset_url(&path)),
    }
}

#[tauri::command]
fn open_external(path: String) -> Result<(), String> {
    open::that(PathBuf::from(path)).map_err(|error| error.to_string())
}

#[tauri::command]
fn app_config() -> Result<AppConfig, String> {
    Ok(read_app_config())
}

#[tauri::command]
fn set_share_port_config(port: Option<u16>, locked: bool) -> Result<AppConfig, String> {
    let config = AppConfig {
        share_port: port,
        share_port_locked: locked,
        locked_share_port: None,
    };
    write_app_config(&config)?;
    Ok(config)
}

#[tauri::command]
async fn choose_root(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let file_path = app.dialog().file().blocking_pick_folder();
    file_path
        .map(|path| {
            path.into_path()
                .map(|path| path.to_string_lossy().to_string())
                .map_err(|error| error.to_string())
        })
        .transpose()
}

#[tauri::command]
async fn start_ocserver(
    path: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    {
        let guard = state.ocserver_port.lock().map_err(|e| e.to_string())?;
        if let Some(port) = *guard {
            return Ok(format!("http://127.0.0.1:{port}"));
        }
    }

    let port = {
        let listener =
            TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("端口分配失败：{e}"))?;
        listener.local_addr().map_err(|e| e.to_string())?.port()
    };

    let cmd = app
        .shell()
        .sidecar("opencode")
        .map_err(|e| format!("sidecar 加载失败：{e}"))?
        .args(["serve", "--port", &port.to_string()])
        .current_dir(&path);

    let (mut rx, child) = cmd.spawn().map_err(|e| format!("启动失败：{e}"))?;

    if let Ok(mut guard) = state.ocserver_child.lock() {
        *guard = Some(child);
    }
    if let Ok(mut guard) = state.ocserver_port.lock() {
        *guard = Some(port);
    }

    let url = format!("http://127.0.0.1:{port}");

    // Wait for server to be ready
    let mut ready = false;
    for _ in 0..30 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            ready = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    if !ready {
        if let Ok(mut guard) = state.ocserver_child.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
        if let Ok(mut guard) = state.ocserver_port.lock() {
            *guard = None;
        }
        return Err("opencode 服务启动超时".into());
    }

    // Process-exit watcher
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        loop {
            match rx.recv().await {
                Some(CommandEvent::Terminated(_)) | Some(CommandEvent::Error(_)) | None => break,
                _ => {}
            }
        }
        if let Ok(mut guard) = app.state::<AppState>().ocserver_child.lock() {
            *guard = None;
        }
        if let Ok(mut guard) = app.state::<AppState>().ocserver_port.lock() {
            *guard = None;
        }
    });

    Ok(url)
}

#[tauri::command]
async fn stop_ocserver(state: State<'_, AppState>) -> Result<(), String> {
    let child = {
        let mut guard = state.ocserver_child.lock().map_err(|e| e.to_string())?;
        guard.take()
    };
    if let Some(child) = child {
        child.kill().map_err(|e| format!("停止失败：{e}"))?;
    }
    if let Ok(mut guard) = state.ocserver_port.lock() {
        *guard = None;
    }
    Ok(())
}

#[tauri::command]
async fn ocserver_version(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_shell::process::CommandEvent;

    let (mut rx, _child) = app
        .shell()
        .sidecar("opencode")
        .map_err(|e| format!("sidecar 加载失败：{e}"))?
        .args(["--version"])
        .spawn()
        .map_err(|e| format!("执行失败：{e}"))?;

    let mut version = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => version.push_str(&String::from_utf8_lossy(&bytes)),
            CommandEvent::Terminated(_) | CommandEvent::Error(_) => break,
            _ => {}
        }
    }
    Ok(version.trim().to_string())
}

#[tauri::command]
async fn ocserver_models(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    use tauri_plugin_shell::process::CommandEvent;

    let (mut rx, _child) = app
        .shell()
        .sidecar("opencode")
        .map_err(|e| format!("sidecar 加载失败：{e}"))?
        .args(["models"])
        .spawn()
        .map_err(|e| format!("执行失败：{e}"))?;

    let mut output = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => output.push_str(&String::from_utf8_lossy(&bytes)),
            CommandEvent::Terminated(_) | CommandEvent::Error(_) => break,
            _ => {}
        }
    }

    Ok(output
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect())
}

pub fn run() {
    let fallback_root = default_root();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            fallback_root: fallback_root.clone(),
            share_root: Arc::new(Mutex::new(fallback_root)),
            share_port: Arc::new(Mutex::new(None)),
            ocserver_child: Arc::new(Mutex::new(None)),
            ocserver_port: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            choose_root,
            share_info,
            list_modules,
            list_directory,
            file_url,
            preview_url,
            open_external,
            app_config,
            set_share_port_config,
            start_ocserver,
            stop_ocserver,
            ocserver_version,
            ocserver_models
        ])
        .run(tauri::generate_context!())
        .expect("error while running oFinder");
}
